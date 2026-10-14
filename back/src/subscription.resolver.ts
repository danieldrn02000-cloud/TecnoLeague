import { Resolver, Subscription } from "@nestjs/graphql";

//resolver de prueba
@Resolver()
export class SubscriptionsResolver {
    @Subscription("pruebaConexion")
    async *pruebaConexion() {
        yield {
        pruebaConexion: "Subscriptions funcionando",
        };
    }
}