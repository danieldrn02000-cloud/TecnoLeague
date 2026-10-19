/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly BACKEND_GRAPHQL_URL?: string;
	readonly AUTH_BRIDGE_SECRET?: string;
	readonly PUBLIC_BACKOFFICE_WS_URL?:string;
	readonly PUBLIC_MP_PUBLIC_KEY?:string;
}