# Bounty «Stablecoin Bridge» (750 $ en PUSD) · plan (14/11, durante BLAZE)

Requisito: puente o cambio de stablecoins hacia y desde BCH (ej. USDC en ETH → PUSD en BCH, y PUSD → USDC). Una red externa basta; más es mejor. Más rápido, barato y fácil = mejor. WizardConnect muy recomendado en el lado BCH; WalletConnect «probablemente esencial» en la otra red.

## Lo que hemos comprobado
- NEAR Intents (1Click) enruta BCH en las dos direcciones y USDC/USDT en 10 redes: NEAR, Ethereum, Base, Arbitrum, Solana, Polygon, BNB, Optimism, Tron (USDT).
- Cauldron (DEX de BCH) tiene 59 pools PUSD/BCH con 511 BCH y 109.000 PUSD. Librería `@cashlab/cauldron` (ISC) para armar el cambio en el navegador; pools desde el indexador de Riften.
- Competencia: «BCH StableBridge» (THORChain + Cauldron) NO firma el cambio en Cauldron desde el navegador; el segundo paso es manual. Nosotros sí: lo firma la cartera por WizardConnect.

## Diseño (sin custodia: Cobra nunca toca fondos)
**Salida: PUSD → USDC en cualquier red, con UNA firma en BCH**
1. El usuario elige red y dirección de destino (ej. USDC en Base).
2. Cobra pide a 1Click una cotización BCH → USDC (dirección de depósito de 1Click).
3. La página arma UNA transacción: cambia PUSD por BCH en Cauldron y manda ese BCH directamente a la dirección de depósito de 1Click. La cartera (Paytaca/Cashonize/Zapit) firma por WizardConnect.
4. 1Click entrega USDC en la red elegida; la página sigue el estado.

**Entrada: USDC (cualquier red) → PUSD**
1. Cotización 1Click USDC@red → BCH a la dirección del usuario (la saca de WizardConnect).
2. El usuario manda USDC (QR / dirección; botón de cartera EVM si da tiempo).
3. Al llegar el BCH, la página arma el cambio BCH → PUSD en Cauldron y la cartera lo firma.

**Dentro de Cobra**
- Facturas: el cliente paga en USDC/USDT de cualquier red y el autónomo puede convertir lo cobrado a PUSD con un toque («Pasar a PUSD»).
- Página `/bridge` independiente para los jueces, con importes pequeños.

## Pasos
- [ ] Cliente Cauldron en el navegador (pools del indexador, mejor precio, cambio PUSD↔BCH) con salida a una dirección cualquiera.
- [ ] Firma por WizardConnect de una transacción que mezcla entradas del pool (sin firma) y de la cartera.
- [ ] Rutas 1Click BCH↔USDC en el servidor (cotización, estado) reutilizando intents.js.
- [ ] Página /bridge: dirección, importe, cotización total con comisiones, seguimiento de los dos pasos.
- [ ] Botón en la factura pagada: «Pasar a PUSD».
- [ ] Tests sin red (cálculo de cambio con pools de ejemplo, armado de la transacción).
- [ ] Prueba real pequeña (céntimos) en las dos direcciones con la Paytaca del usuario.
- [ ] Texto del bounty y entrega.

## Riesgos
- La firma de transacciones con contratos (pools de Cauldron) por WizardConnect: comprobar pronto que Paytaca la acepta.
- Mínimos de 1Click: puede pedir un importe mínimo para BCH (comprobar con cotizaciones reales).

## Progreso
14/11 tarde: comprobado que 1Click acepta importes de céntimos (0,10 $ BCH → 0,104 USDC en Base, <2 min). Prototipo con pools reales: 1 PUSD → ~467.585 sats repartido en 7 pools, BCH pagado a una dirección ajena (depósito 1Click) en la misma transacción. Escrito client/bridge.js (pools del indexador de Riften, quote, sellPusd con salida a otra dirección, buyPusd, balances; firma por WizardConnect dejando las entradas del pool con su desbloqueo de contrato) y empaquetado aparte en src/bridge.gen.js (1,5 MB).
Falta: servir /bridge.js y la página /bridge en el Worker, rutas del servidor para cotizar y seguir 1Click (BCH↔USDC), botón «Pasar a PUSD», tests, desplegar y probar con la Paytaca del usuario (comprobar que firma transacciones con pools de Cauldron).
14/11 noche: servidor (src/bridge.js: 12 stablecoins en 8 redes, cotización EXACT_INPUT y estado de 1Click), página /bridge (src/bridgepage.js) con los dos sentidos y el banner, /bridge.js servido, 3 tests (37). Probado en local: cotización real 1 PUSD → 0,991 USDC en Base; 1 USDC Arbitrum → 0,00476 BCH; QR de WizardConnect. Falta: prueba real con Paytaca (firma con pools de Cauldron) y botón «Pasar a PUSD» en el bot.
