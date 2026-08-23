import { signHarnessBootstrapToken } from "@/lib/harness/bootstrap-token";
import { getHarnessConfig } from "@/lib/harness/config";

type Fetcher = typeof fetch;

export async function callHarnessRpc(
  userId: string,
  path: string,
  body: unknown,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  const { origin, cookie } = await createGatewaySession(userId, fetcher);
  const response = await fetcher(`${origin}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Harness 请求失败"));
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Harness 返回了无效 JSON");
  }
}

async function createGatewaySession(userId: string, fetcher: Fetcher) {
  const config = getHarnessConfig();
  if (userId !== config.ownerUserId) throw new Error("FORBIDDEN");

  const token = await signHarnessBootstrapToken(userId);
  const response = await fetcher(
    `${config.publicOrigin}/auth/bootstrap?token=${encodeURIComponent(token)}`,
    {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
    },
  );
  if (response.status !== 302 && !response.ok) {
    throw new Error(await readError(response, "Harness 身份交换失败"));
  }

  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0]?.trim();
  if (!cookie?.startsWith("dsh_embed=")) {
    throw new Error("Harness 身份交换未返回会话 Cookie");
  }
  return { origin: config.publicOrigin, cookie };
}

async function readError(response: Response, fallback: string) {
  try {
    const text = (await response.text()).trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}
