export interface ServerConfig {
  host: string;
  port: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const portRaw = env.PORT ?? "8080";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 0) {
    throw new Error(`invalid PORT: ${portRaw}`);
  }
  return {
    host: env.HOST ?? "0.0.0.0",
    port,
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
