# Spendlens — Canlıya Alma Rehberi (Docker)

Bu rehber Spendlens'i kendi sunucunda (VPS) Docker ile yayına almanı anlatır.
Sonuç: kullanıcıların kayıt olup giriş yapabildiği, kendi agent'larını API
anahtarıyla bağlayıp gerçek harcama verisi gönderebildiği çok kiracılı
(multi-tenant) bir kurulum.

---

## 1. Gereksinimler

- Docker Engine 24+ ve Docker Compose v2 (`docker compose version`)
- Bir alan adı (örn. `spendlens.ornek.com`) ve ona bakan bir A kaydı
- 1 vCPU / 1 GB RAM yeterli başlangıç için (Postgres + Next.js aynı makinede)
- Giden SMTP ya da bir Resend hesabı (e-posta doğrulama / parola sıfırlama için)

---

## 2. Kodu sunucuya al

```bash
git clone <repo-url> spendlens
cd spendlens
```

---

## 3. Ortam değişkenlerini ayarla

```bash
cp .env.example .env
```

`.env` içinde en az şunları doldur:

| Değişken | Açıklama |
|---|---|
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | Sitenin genel adresi, örn. `https://spendlens.ornek.com` (sonunda `/` yok) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` ile üret |
| `POSTGRES_PASSWORD` | Güçlü bir parola |
| `EMAIL_FROM` | Gönderen adresi, örn. `Spendlens <no-reply@ornek.com>` |
| `RESEND_API_KEY` **veya** `SMTP_*` | Parola sıfırlama e-postası için. İkisi de boşsa sıfırlama linki sadece konteyner loguna yazılır. (E-posta **doğrulaması** şu an kapalı; kayıt olan kullanıcı doğrudan girer.) |

`DATABASE_URL`'i elle ayarlamana gerek yok — `docker-compose.yml`, `web`
konteyneri için onu `db` servisinden otomatik kurar.

### Google / GitHub ile giriş

Kod hazır — sadece OAuth uygulamalarını sen açıp `.env`'e id/secret koyacaksın.
İkisi de boşsa butonlar görünmez, e-posta+parola girişi yine çalışır. Bir env
çifti dolunca ilgili buton `/login` ve `/signup` sayfalarında belirir.

**GitHub** — https://github.com/settings/developers → **New OAuth App**
- Homepage URL: `https://spendlens.ornek.com`
- **Authorization callback URL:** `https://spendlens.ornek.com/api/auth/callback/github` (birebir)
- `.env`: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

**Google** — https://console.cloud.google.com/apis/credentials → **Create credentials → OAuth client ID → Web application**
- **Authorized redirect URIs:** `https://spendlens.ornek.com/api/auth/callback/google` (birebir)
- (OAuth consent screen'i de doldurman gerekir — External, birkaç scope: email, profile, openid)
- `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

Yerelde denemek için callback'leri `http://localhost:3000/api/auth/callback/...`
olarak da ekleyebilirsin. Env'i güncelledikten sonra `docker compose up -d`
(ya da yerelde sunucuyu yeniden başlat).

Hesaplar doğrulanmış e-postaya göre birleşir: parolayla kayıt olan biri sonradan
**Ayarlar → Connected accounts**'tan Google/GitHub ekleyip çıkarabilir
(en az bir giriş yöntemi kalmak şartıyla).

---

## 4. Başlat

```bash
docker compose up -d --build
```

- `db` (Postgres 16) ve `web` (Next.js) ayağa kalkar.
- `web` konteyneri açılışta bekleyen **veritabanı migration'larını otomatik
  çalıştırır** (`RUN_MIGRATIONS_ON_BOOT=true`). Ayrı bir adım yok.

Durumu izle:

```bash
docker compose logs -f web
```

`✓ Ready` ve `[spendlens] migrations up to date` satırlarını görünce hazırsın.
Uygulama konteyner içinde `3000` portunda; host'ta `WEB_HOST_PORT` (varsayılan
`3000`).

---

## 5. Önüne bir reverse proxy koy (HTTPS)

Next.js'i doğrudan internete açma. Örnek **Caddy** (otomatik HTTPS):

```caddyfile
spendlens.ornek.com {
    reverse_proxy 127.0.0.1:3000
}
```

Nginx kullanıyorsan: `proxy_pass http://127.0.0.1:3000;` + `proxy_set_header
Host $host;` ve `X-Forwarded-*` başlıkları + Let's Encrypt (certbot).

`APP_URL` mutlaka `https://...` olmalı — oturum çerezleri `Secure` işaretli
gönderilir.

---

## 6. İlk hesap

1. `https://spendlens.ornek.com/signup` → kayıt ol
2. Doğrudan panele düşersin (e-posta doğrulaması şu an kapalı).
3. "Load sample data" ile örnek veriyi yükleyip tüm ekranları dolu
   görebilirsin, ya da doğrudan **New agent** ile başlayabilirsin.

> E-posta doğrulamasını sonra açmak istersen: `src/lib/auth/index.ts` içinde
> `requireEmailVerification` ve `emailVerification.sendOnSignUp` değerlerini
> `true` yap, `src/lib/auth/dal.ts`'deki `requireVerifiedUser`'a
> `emailVerified` kontrolünü geri ekle. Bir e-posta sağlayıcısı (`RESEND_API_KEY`
> ya da `SMTP_*`) şart.

---

## 7. Bir agent'ı SDK ile bağlamak

1. Panelde **New agent** → bir id ver (örn. `research-crawler-01`)
2. Agent sayfasında **Create key** → çıkan `sl_...` anahtarını kaydet (bir daha
   gösterilmez). Aynı sayfadaki **Send test event** butonu, hiç kod yazmadan
   ledger'ın tepki verdiğini görmeni sağlar.
3. Agent projesinde SDK'yı kur (uygulama servis ediyor):

```bash
npm install https://spendlens.ornek.com/downloads/spendlens-sdk.tgz
# ya da tek dosya: curl -O https://spendlens.ornek.com/downloads/spendlens-sdk.mjs
```

4. Agent'ın ortam değişkenleri:

```bash
SPENDLENS_URL=https://spendlens.ornek.com
SPENDLENS_API_KEY=sl_...
```

5. Agent kodunda:

```ts
import { guard, createLocalSigner } from "@spendlens/sdk";

const pay = guard({
  agentId: "research-crawler-01",
  // apiKey + sink verilmezse SPENDLENS_API_KEY / SPENDLENS_URL'den okunur
  // policy: yamlString,                                   // opsiyonel; varsayılan geniş
  // signer: createLocalSigner(process.env.AGENT_PRIVATE_KEY), // gerçek ödeme için
});

const res = await pay.fetch("https://api.saglayici.io/v1/data", { taskId: "task-001" });
```

`pay.fetch` yalnızca HTTP **402** ödeme talebi gelince devreye girer; diğer her
istek dokunulmadan geçer. `signer` vermezsen sahte imza kullanılır (log'a
uyarı yazar) — policy, telemetri ve kalite analizi gerçek çalışır ama ödeme
zincirde gerçekleşmez.

Kararlar ve telemetri asenkron olarak panele akar. Agent'ı acil durumda
panelden **Halt agent (kill switch)** ile durdurabilirsin; bu durumda ingest
`423` döner.

> Tüm döngüyü 30 saniyede görmek için repo kökünde:
> `SPENDLENS_URL=... SPENDLENS_API_KEY=sl_... SPENDLENS_AGENT_ID=... npm run example`

### Gerçek Circle Nanopayments (Arc + Circle Gateway)

Gazsız, toplu (batched) USDC mikroödemeleri için genel `guard()` yerine
`@circle-fin/x402-batching`'in `GatewayClient`'ını `guardGateway` ile sar:

```bash
npm run new-wallet                 # AGENT_ADDRESS/AGENT_PRIVATE_KEY -> .env
# AGENT_ADDRESS'i https://faucet.circle.com'dan testnet USDC ile fonla (Circle girişi gerekir)
npm install @circle-fin/x402-batching viem
```

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { guardGateway } from "@spendlens/sdk";

const client = new GatewayClient({ chain: "arcTestnet", privateKey });
// await client.deposit("1");   // bir kez, on-chain
const pay = guardGateway(client, { agentId: "research-crawler-01" });
const { data, transaction } = await pay.fetch("https://gercek-x402-endpoint/premium", { taskId: "t1" });
```

Cüzdan anahtarı `GatewayClient` içinde kalır — Spendlens policy'yi
`onBeforePaymentCreation` hook'una takar. Zincir uzlaşmasını panele beslemek
için: `npm run reconcile:arc` (agent sayfasında cüzdan adresini de gir).

Arc chain id'leri: **testnet 5042002**, **mainnet 5042**. Mainnet için
`ARC_NETWORK=mainnet` ve `ARC_MAINNET_RPC_URL` ayarla. Ayrıntı: **ARC.md**.

---

## 8. Bakım

| İş | Komut |
|---|---|
| Güncelle | `git pull && docker compose up -d --build` (migration'lar açılışta çalışır) |
| Loglar | `docker compose logs -f web` / `... db` |
| DB yedeği | `docker compose exec db pg_dump -U spendlens spendlens > yedek.sql` |
| DB geri yükle | `cat yedek.sql \| docker compose exec -T db psql -U spendlens spendlens` |
| Migration'ı elle çalıştır | `docker compose exec web node -e "require('./server.js')"` yerine: yeni deploy'da otomatik. Yerelde: `npm run db:migrate` |
| Durdur | `docker compose down` (veriler `db-data` volume'ünde kalır) |
| Her şeyi sil | `docker compose down -v` (**veritabanı dahil siler**) |

---

## 9. Sorun giderme

- **`web` açılışta çıkıyor, logda `DATABASE_URL is not set`** — `.env` dosyan
  yok ya da `docker compose` onu okumadı. `.env` proje kökünde mi?
- **`web` "waiting for db"'de takılı** — `docker compose logs db`; parola /
  volume çakışması olabilir. Temiz başlangıç: `docker compose down -v`.
- **Doğrulama / sıfırlama e-postası gelmiyor** — `RESEND_API_KEY` ya da `SMTP_*`
  ayarlı mı? Ayarlı değilse link `docker compose logs web` içinde.
- **OAuth "redirect_uri_mismatch"** — sağlayıcıdaki callback URL birebir
  `https://<alan-adin>/api/auth/callback/<provider>` olmalı.
- **502 / sonsuz login döngüsü** — reverse proxy `Host` ve `X-Forwarded-Proto`
  başlıklarını iletmiyor olabilir; `APP_URL` `https://` ile başlamalı.

---

## Mimari özet

- **Next.js 16** (standalone çıktı) — panel + pazarlama sitesi + API rotaları
- **Better Auth** — e-posta+parola, e-posta doğrulama, parola sıfırlama, Google/GitHub
- **Postgres 16** + **Drizzle ORM** — tüm veri kullanıcı bazında izole
- **`@spendlens/sdk`** — 402 yakalama, policy motoru, anomali/kalite/uzlaşma;
  telemetri `Authorization: Bearer <api-key>` ile ingest ucuna gider
- Migration'lar `instrumentation.register()` içinden açılışta uygulanır
