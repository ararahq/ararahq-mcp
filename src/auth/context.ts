import { AsyncLocalStorage } from "node:async_hooks";

type AuthContext = { accessToken: string };
const storage = new AsyncLocalStorage<AuthContext>();

export const runWithAccessToken = <T>(accessToken: string, task: () => T): T =>
  storage.run({ accessToken }, task);

export const getRequestAccessToken = (): string | undefined => storage.getStore()?.accessToken;
