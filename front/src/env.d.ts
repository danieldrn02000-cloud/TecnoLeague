/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GOOGLE_CLIENT_ID?: string;
	readonly BACKEND_GRAPHQL_URL?: string;
	readonly AUTH_BRIDGE_SECRET?: string;
	readonly PUBLIC_BACKOFFICE_WS_URL?:string;
	readonly PUBLIC_MP_PUBLIC_KEY?:string;
}
