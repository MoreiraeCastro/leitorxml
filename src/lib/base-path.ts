export const BASE_PATH = "/leitorxml";

/** next/link e redirect() do next/navigation já respeitam o basePath sozinhos. Use isto só para strings de caminho cruas (ex.: action de <form> nativo, fetch() do cliente) que o Next não reescreve automaticamente. */
export function withBasePath(path: string) {
  return `${BASE_PATH}${path}`;
}
