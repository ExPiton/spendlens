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
| `RESEND_API_KEY` **veya** `SMTP_*` | E-posta gönderimi. İkisi de boşsa doğrulama linkleri sadece konteyner loguna yazılır (sadece test için). |

`DATABASE_URL`'i elle ayarlamana gerek yok — `docker-compose.yml`, `web`
konteyneri için onu `db` servisinden otomatik kurar.

### İsteğe bağlı: Google / GitHub ile giriş

Boş bırakırsan ilgili buton görünmez, e-posta+parola girişi yine çalışır.

- **GitHub:** https://github.com/settings/developers → New OAuth App
  - Authorization callback URL: `https://spendlens.ornek.com/api/auth/callback/github`
  - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- **Google:** https://console.cloud.google.com/apis/credentials → OAuth client ID (Web)
  - Authorized redirect URI: `https://spendlens.ornek.com/api/auth/callback/google`
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

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
2. Doğrulama e-postasındaki linke tıkla (e-posta ayarlı değilse
   `docker compose logs web` içinde linki bulursun)
3. Panele düşersin. "Load sample data" ile örnek veriyi yükleyip tüm ekranları
   dolu görebilirsin, ya da doğrudan **New agent** ile başlayabilirsin.

---

## 7. Bir agent'ı SDK ile bağlamak

1. Panelde **New agent** → bir id ver (örn. `research-crawler-01`)
2. Agent sayfasında **Create key** → çıkan `sl_...` anahtarını bir yere kaydet
   (bir daha gösterilmez)
3. Agent kodunda:

```ts
import { guard } from "@spendlens/sdk";

const pay = guard({
  agentId: "research-crawler-01",
  apiKey: process.env.SPENDLENS_API_KEY,        // az önce oluşturduğun sl_... anahtarı
  sink: "https://spendlens.ornek.com/api/authorizations",
  policy: "./policies/research-crawler-01.yaml", // ya da bir YAML string
});

const res = await pay.fetch("https://api.saglayici.io/v1/data", {
  taskId: "task-001",
});
```

Kararlar (allow / block / hold) ve telemetri asenkron olarak panele akar.
Agent'ı acil durumda panelden **Halt agent (kill switch)** ile durdurabilirsin;
bu durumda ingest `423` döner.

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
