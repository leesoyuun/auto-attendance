import { JWT } from "google-auth-library";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** 429/5xx 재시도. 구글 시트는 사용자당 분당 읽기 60회 제한이 있습니다. */
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 600;

export interface SheetConfig {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
}

export function configFromEnv(): SheetConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!spreadsheetId || !clientEmail || !privateKey) return null;
  return {
    spreadsheetId,
    clientEmail,
    // .env 한 줄에 담으려면 개행을 \n 으로 적게 되므로 되돌립니다.
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

export interface TabProperties {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

/** 시트 값. 숫자·문자·불리언이 섞여 옵니다. */
export type CellValue = string | number | boolean | null;

/**
 * 구글 시트 REST API 얇은 래퍼.
 *
 * googleapis 전체를 받지 않고 인증만 google-auth-library 로 처리합니다.
 * 필요한 건 값 읽기/쓰기와 batchUpdate 뿐입니다.
 */
export class SheetClient {
  private auth: JWT;

  constructor(private config: SheetConfig) {
    this.auth = new JWT({
      email: config.clientEmail,
      key: config.privateKey,
      scopes: [SCOPE],
    });
  }

  private async request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
    const { token } = await this.auth.getAccessToken();
    if (!token) {
      throw new Error("구글 인증 토큰을 받지 못했습니다. 서비스 계정 설정을 확인하세요.");
    }
    const response = await fetch(`${API}/${this.config.spreadsheetId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
    const text = await response.text();

    if (!response.ok) {
      // 429/5xx 는 잠시 뒤 다시 하면 대개 됩니다. 구글 시트는 분당 읽기 60회
      // 제한이 있어서, 여러 사람이 새로고침하면 어렵지 않게 걸립니다.
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const waitMs = BASE_BACKOFF_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return this.request<T>(path, init, attempt + 1);
      }

      const hint =
        response.status === 403
          ? ` — 시트를 ${this.config.clientEmail} 에 편집자로 공유했는지 확인하세요.`
          : response.status === 429
            ? " — 구글 시트 분당 요청 제한에 걸렸습니다. 잠시 뒤 다시 시도해주세요."
            : "";
      throw new Error(`시트 요청 실패 (${response.status})${hint}\n${text.slice(0, 400)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async listTabs(): Promise<TabProperties[]> {
    const data = await this.request<{
      sheets?: Array<{
        properties: {
          sheetId: number;
          title: string;
          gridProperties?: { rowCount?: number; columnCount?: number };
        };
      }>;
    }>("?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))");

    return (data.sheets ?? []).map((s) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount ?? 0,
      columnCount: s.properties.gridProperties?.columnCount ?? 0,
    }));
  }

  /**
   * @param render FORMATTED_VALUE(기본) / UNFORMATTED_VALUE / FORMULA.
   *   날짜 헤더처럼 서식이 걸린 셀은 원시값을 봐야 정확합니다.
   */
  async getValues(
    range: string,
    render: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA" = "FORMATTED_VALUE",
  ): Promise<CellValue[][]> {
    const data = await this.request<{ values?: CellValue[][] }>(
      `/values/${encodeURIComponent(range)}?valueRenderOption=${render}`,
    );
    return data.values ?? [];
  }

  /**
   * @param input RAW 는 문자 그대로, USER_ENTERED 는 수식과 날짜를 해석합니다.
   *   수식(`=SUM(...)`)을 쓸 때는 반드시 USER_ENTERED 여야 합니다.
   */
  async setValues(
    range: string,
    values: CellValue[][],
    input: "RAW" | "USER_ENTERED" = "USER_ENTERED",
  ): Promise<void> {
    await this.request(`/values/${encodeURIComponent(range)}?valueInputOption=${input}`, {
      method: "PUT",
      body: JSON.stringify({ values }),
    });
  }

  /**
   * 여러 범위를 **한 번의 요청**으로 읽습니다.
   *
   * 탭마다 따로 읽으면 탭 개수만큼 요청이 나가서 분당 제한(60회)에 금방 걸립니다.
   * 반환 배열의 순서는 요청한 ranges 순서와 같습니다.
   */
  async batchGetValues(
    ranges: string[],
    render: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA" = "FORMATTED_VALUE",
  ): Promise<CellValue[][][]> {
    if (ranges.length === 0) return [];
    const query = ranges
      .map((r) => `ranges=${encodeURIComponent(r)}`)
      .join("&");
    const data = await this.request<{ valueRanges?: Array<{ values?: CellValue[][] }> }>(
      `/values:batchGet?${query}&valueRenderOption=${render}`,
    );
    return (data.valueRanges ?? []).map((v) => v.values ?? []);
  }

  async clearRange(range: string): Promise<void> {
    await this.request(`/values/${encodeURIComponent(range)}:clear`, { method: "POST" });
  }

  async batchUpdate<T = unknown>(requests: unknown[]): Promise<T> {
    return this.request<T>(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }
}
