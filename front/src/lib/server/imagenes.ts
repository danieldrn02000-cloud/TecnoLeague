import { backendGraphqlUrl } from "./backend-url";

export function backendResourceUrl(path: string) {
  return new URL(path, backendGraphqlUrl());
}
