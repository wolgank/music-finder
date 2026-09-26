// music-vault-server/src/lib/tidal/auth.ts
import axios from "axios";

export class TidalAuth {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiration: number = 0; // Marca de tiempo (epoch) de cuándo expira

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Obtiene un token válido. Si ya tenemos uno y no ha expirado,
   * devuelve el guardado. Si no, pide uno nuevo a Tidal.
   */
  async getToken(): Promise<string> {
    // 1. Verificar si tenemos un token válido en caché (con un margen de seguridad de 60s)
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiration - 60000) {
      //console.log("\n🔥 --- TOKEN COMPLETO DE TIDAL (COPIAR ABAJO) --- 🔥");
      //console.log(this.accessToken);
      //console.log("🔥 ------------------------------------------------ 🔥\n");
      return this.accessToken;
    }

    console.log("🔄 Generando nuevo Access Token de Tidal...");

    try {
      // 2. Crear la cadena Base64 tal como lo hace tu ejemplo de curl
      // B64CREDS=$(echo -n "<CLIENT_ID>:<CLIENT_SECRET>" | base64)
      const credentialsString = `${this.clientId}:${this.clientSecret}`;
      const base64Credentials = Buffer.from(credentialsString).toString("base64");

      // 3. Preparar el cuerpo de la petición (grant_type=client_credentials)
      // Usamos URLSearchParams para simular el formato 'application/x-www-form-urlencoded' del curl -d
      const params = new URLSearchParams();
      params.append("grant_type", "client_credentials");

      // 4. Hacer la llamada a https://auth.tidal.com/v1/oauth2/token
      const response = await axios.post(
        "https://auth.tidal.com/v1/oauth2/token",
        params, 
        {
          headers: {
            "Authorization": `Basic ${base64Credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      // 5. Guardar el token y calcular cuándo expira
      const { access_token, expires_in } = response.data;
      
      this.accessToken = access_token;
      // expires_in viene en segundos, lo convertimos a milisegundos y sumamos a la hora actual
      this.tokenExpiration = now + (expires_in * 1000);

      console.log("✅ Token de Tidal generado correctamente.");
      return this.accessToken as string;

    } catch (error: any) {
      console.error("❌ Error fatal obteniendo el token de Tidal:");
      if (error.response) {
        console.error("Status:", error.response.status);
        console.error("Data:", error.response.data);
      } else {
        console.error(error.message);
      }
      throw new Error("No se pudo autenticar con Tidal. Revisa CLIENT_ID y CLIENT_SECRET.");
    }
  }
}