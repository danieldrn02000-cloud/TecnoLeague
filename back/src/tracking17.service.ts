import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";

const BASE_URL = "https://api.17track.net/track/v2.4";

type ApiItem = {
  number?: string;
  carrier?: number;
  error?: { code?: number };
  track_info?: {
    latest_status?: { status?: string };
    latest_event?: { time_utc?: string; description?: string };
    tracking?: {
      providers?: {
        events?: { time_utc?: string; description?: string }[];
      }[];
    };
  };
};

type ApiResponse = {
  code?: number;
  data?: {
    accepted?: ApiItem[];
    rejected?: ApiItem[];
  };
};

export type TrackingUpdate = {
  carrierId: number | null;
  status: string;
  description: string | null;
  updatedAt: Date;
};

@Injectable()
export class Tracking17Service {
  private apiKey() {
    const key = process.env.TRACK17_API_KEY?.trim();
    if (!key) {
      throw new GraphQLError(
        "Falta configurar TRACK17_API_KEY en el entorno del backend.",
        { extensions: { code: "SERVICE_UNAVAILABLE" } },
      );
    }
    return key;
  }

  private async request(path: string, body: unknown): Promise<ApiResponse> {
    const apiKey = this.apiKey();
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/${path}`, {
        method: "POST",
        headers: {
          "17token": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new GraphQLError("No se pudo conectar con 17TRACK. Intenta de nuevo.", {
        extensions: { code: "BAD_GATEWAY" },
      });
    }

    if (!response.ok) {
      throw new GraphQLError(
        response.status === 401
          ? "17TRACK rechazó la API Key configurada."
          : `17TRACK respondió con un error HTTP (${response.status}).`,
        { extensions: { code: "BAD_GATEWAY" } },
      );
    }

    const result = (await response.json().catch(() => null)) as ApiResponse | null;
    if (!result || result.code !== 0 || !result.data) {
      throw new GraphQLError("17TRACK devolvió una respuesta inválida.", {
        extensions: { code: "BAD_GATEWAY" },
      });
    }
    return result;
  }

  async register(number: string, carrierId: number | null) {
    const result = await this.request("register", [
      {
        number,
        ...(carrierId !== null ? { carrier: carrierId } : {}),
        lang: "es",
      },
    ]);
    const accepted = result.data?.accepted?.find(
      (item) => item.number?.toLowerCase() === number.toLowerCase(),
    );
    if (accepted) return accepted.carrier ?? carrierId;

    const rejected = result.data?.rejected?.find(
      (item) => item.number?.toLowerCase() === number.toLowerCase(),
    );
    if (rejected?.error?.code === -18019901) return carrierId;
    throw new GraphQLError(
      rejected?.error?.code === -18019903
        ? "17TRACK no identificó la paquetería. Indica un código de transportista válido."
        : "17TRACK no pudo registrar esta guía. Revisa el número y la paquetería.",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  async getTracking(number: string, carrierId: number | null): Promise<TrackingUpdate> {
    const result = await this.request("gettrackinfo", [
      { number, ...(carrierId !== null ? { carrier: carrierId } : {}) },
    ]);
    const item = result.data?.accepted?.find(
      (entry) => entry.number?.toLowerCase() === number.toLowerCase(),
    );
    const trackInfo = item?.track_info;
    if (!trackInfo) {
      throw new GraphQLError(
        "17TRACK todavía no tiene información para esta guía. Vuelve a consultar más tarde.",
        { extensions: { code: "NOT_FOUND" } },
      );
    }
    const events = trackInfo.tracking?.providers
      ?.flatMap((provider) => provider.events ?? [])
      .sort(
        (a, b) =>
          Date.parse(b.time_utc ?? "") - Date.parse(a.time_utc ?? ""),
      );
    const event =
      trackInfo.latest_event?.description ||
      events?.find((candidate) => candidate.description)?.description;
    const status = trackInfo.latest_status?.status;
    if (!status) {
      throw new GraphQLError("17TRACK no devolvió un estado de envío válido.", {
        extensions: { code: "BAD_GATEWAY" },
      });
    }
    return {
      carrierId: item.carrier ?? carrierId,
      status,
      description: event || null,
      updatedAt: new Date(),
    };
  }
}
