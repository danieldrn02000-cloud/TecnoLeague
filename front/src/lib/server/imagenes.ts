export function backendResourceUrl(path: string) {
  return new URL(
    path,
    import.meta.env.BACKEND_GRAPHQL_URL || "http://127.0.0.1:4000/graphql",
  );
}
