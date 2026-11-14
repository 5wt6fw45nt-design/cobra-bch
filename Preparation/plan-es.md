# BCH BLAZE 2026 · Cobra en Bitcoin Cash

Entrega: DoraHacks, hasta el DOM 22/11 14:00 UTC. Requisitos (bases leídas el 13/11): pago BCH real que cualquier juez pueda hacer desde la web, WizardConnect o XO, banner arriba con presentación (plantilla «Widget Factory»), repo y dirección CashTokens del usuario para donaciones EMBER2026, y separar lo previo de lo nuevo.

Jueces: innovación, diseño/usabilidad, técnica (uso de BCH y CashTokens, sin fallos), negocio. Miran un par de minutos: tiene que funcionar a la primera.

## Qué añadimos (todo nuevo durante el hackathon)

- [x] **Cobro directo en BCH.** El autónomo pone su dirección `bitcoincash:`. La factura en EUR/USD se pasa a BCH al precio del momento y se le suma una «marca» de unos pocos satoshis con el número de factura, para distinguir dos facturas iguales.
- [x] **Cobro en PUSD (ParyonUSD, stablecoin CashToken, patrocinador).** Factura en dólares pagada en PUSD exactos al céntimo. Categoría 2469acc5…2544, 2 decimales (comprobar en la cadena antes de usarla).
- [x] **Botón «Pagar con mi cartera» (WizardConnect).** En la página de pago: QR → Paytaca/Cashonize/Zapit → la página arma la transacción (pago al autónomo + OP_RETURN `cobra <factura>`) y la cartera solo firma. Librerías: `@wizardconnect/dapp`, `@bitauth/libauth`, `@electrum-cash/network`, empaquetadas con esbuild en un JS que sirve el Worker.
- [x] **QR BIP21 de respaldo** para carteras sin WizardConnect (se reconoce por el importe marcado).
- [x] **Vigilancia del pago** desde el Worker (cron del reloj): servidor Electrum/Fulcrum público por WebSocket, historial y mempool de la dirección; acepta el pago por OP_RETURN o por importe exacto; para PUSD mira `token_data`. Aviso al autónomo en Telegram con enlace al explorador. Pago en mempool = «llegando», 1 confirmación = «pagado».
- [ ] **Recibo como CashToken (si da tiempo):** NFT inmutable con el número de factura. Solo si se puede sin que Cobra guarde fondos de nadie.
- [x] **Tests** (sin red) para importes, marca, OP_RETURN, BIP21 y detección de pago.
- [x] **Página para jueces:** factura de demostración de 0,10 $ con un botón, para que paguen en BCH real sin abrir Telegram.
- [~] **Banner + README:** (hechos; falta el enlace de la presentación) presentación, repo, dirección `bitcoincash:zpwlcxelj25wkpsq7qjmyftfy4tt7hnefvk3jhxmcx`, qué existía antes (enlace a cobra-near y su demo de X) y qué es nuevo.
- [ ] **Despliegue** del Worker cobra-near (con el visto bueno del usuario) y prueba real con un pago pequeño desde Paytaca.
- [ ] **Presentación Widget Factory**: el usuario copia la plantilla de Google Slides; yo le paso el texto de cada diapositiva.
- [ ] **Envío en DoraHacks** (lo hace el usuario con los textos que le preparo).

## Qué hace el usuario
- 14/11 15:00: pasar lista en el directo (bchblaze.cash/live, CONNECT WALLET con Paytaca).
- Un poco de BCH en Paytaca (unos céntimos) para la prueba real de pago.
- Copiar la plantilla de presentación y pegar los textos.
- Enviar el proyecto en DoraHacks.

## Revisión
14/11: hecho en local y con 34 tests (6 nuevos). Probado en el navegador con wrangler dev: portada con banner, /demo crea factura de 0,10 $, la página da importe BCH marcado + QR BIP21, PUSD exacto a la dirección z, el botón WizardConnect conecta con el relay y muestra el QR de emparejamiento, y la vigilancia por Fulcrum funciona dentro del runtime de Workers sin errores.
Pendiente: desplegar (visto bueno), probar un pago real con Paytaca, enlace de la presentación, commit/push, envío en DoraHacks.
Recibo NFT: descartado por ahora (exigiría que Cobra guardara fondos para acuñar).
