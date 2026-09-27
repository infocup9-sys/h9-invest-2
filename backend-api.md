# API per Render

## Modalità attuale

L'app usa `mock-api.js` come backend dimostrativo locale. `script.js` seleziona questo adattatore con `USE_MOCK_BACKEND = true`; gli account e i relativi dati persistono in `localStorage` per questo browser e non vengono eliminati al refresh. Il token di accesso resta in `sessionStorage`, separato per scheda, e il logout invalida solo la sessione corrente senza cancellare l'account o i suoi dati. Ogni sessione utente può leggere e aggiornare solo l'account associato al proprio token. Le funzioni di amministrazione esistenti restano disponibili alle sessioni con ruolo admin, secondo le rotte `/api/admin/*`. I dati non sono sincronizzati tra browser o dispositivi. L'adattatore riproduce le rotte HTTP previste.

Per collegare Render, impostare `USE_MOCK_BACKEND = false` e inserire l'origine HTTPS del servizio in `RENDER_API_BASE`. Il servizio Render dovrà consentire CORS per l'origine del frontend.

## Contratto richiesto al servizio

- `POST /api/auth/register` — `{ username, email, password }`; crea un ID account univoco e restituisce `{ token, account }`.
- `POST /api/auth/login` — `{ email, password }`; verifica le credenziali e restituisce `{ token, account }`.
- `POST /api/auth/logout` — invalida solo la sessione Bearer corrente; non elimina l'account o i suoi dati.
- `PUT /api/auth/password` — `{ currentPassword, newPassword }`; verifica la password attuale e aggiorna l’hash della password.
- `GET /api/account` — restituisce solo l’account legato alla sessione, con `id`, `revision`, `wallet`, `investments`, `transactions`, `depositRequests`, `withdrawalRequests`, `preferences` e `withdrawalWallet`.
- `GET /api/admin/accounts` — elenco account, solo per amministratore; mantiene la funzione admin di visualizzazione e gestione degli account.
- `PUT /api/account` — aggiornamento dell’account corrente e delle sue preferenze con `revision` per rilevare modifiche concorrenti.
- `PUT /api/admin/account` — aggiornamento amministrativo di un altro account, con `revision`; solo per amministratore.
- `POST /api/admin/rewards/credit` — `{ accountId, points, spins }`; accredita punti H9 e giri bonus a un account, solo per amministratore.
- `DELETE /api/admin/accounts` — elimina gli account demo, solo per amministratore e su azione esplicita; non è l'operazione di logout.
- `POST /api/deposits` — `{ amount, network, txHash }`.
- `POST /api/withdrawals` — `{ amount, network, address }`; il server verifica e riserva il saldo guadagni.
- `POST /api/investments` — `{ amount, planId }`; il server verifica il saldo deposito e stabilisce importo, piano, data iniziale e snapshot delle percentuali `allocation`.
- `POST /api/rewards/purchase` — `{ rewardId }`; addebita punti e attiva un bonus temporaneo o accredita un coupon demo.
- `POST /api/rewards/spin` — un premio punti al giorno; il server deve verificare giorno e probabilità e registrare l'esito in modo atomico.

Il servizio deve conservare password con hash salato e associare ogni token a un singolo account e a una sessione indipendente. Le rotte utente devono autorizzare e limitare ogni lettura e modifica all'account associato al token, senza sessioni condivise tra utenti. Solo le rotte `/api/admin/*` possono operare sugli account altrui e devono verificare il ruolo admin lato server. Il logout invalida la sola sessione corrente senza cancellare dati utente. Le operazioni sul saldo devono essere atomiche.

L’account può inoltre includere `preferences` (`language`, `theme`, `notificationsSeenAt`) e `withdrawalWallet` (`network`, `address`) per sincronizzare lingua, modalità visiva, notifiche già lette e wallet preferito. La demo locale salva questi dati nel browser.

## Punti H9 e premi demo

Nella demo, 2.500 punti H9 corrispondono al valore indicativo di 1 USDT. Gli inviti assegnano una quantità fissa di punti alla creazione dell’account e non dipendono dall’attività finanziaria dell’invitato. I coupon aggiungono USDT simulati al saldo guadagni; non è collegato un servizio di pagamento reale.

La ruota assegna punti una volta al giorno secondo i pesi in `rewards-model.js`. I cinque premi con valore superiore a 10 USDT hanno un ticket ciascuno su 50.000.000, per una probabilità combinata di 1 su 10.000.000. Il mock salva ogni estrazione e impedisce una seconda estrazione nello stesso giorno UTC.

## Accrediti giornalieri

Il servizio Render dovrà avere un'attività pianificata giornaliera, indipendente dalle sessioni utente, che carica gli investimenti attivi, registra una sola voce ledger per account/investimento/giorno e accredita il saldo guadagni. Alla scadenza restituisce il capitale al saldo deposito. L'idempotenza deve impedire accrediti doppi in caso di retry del job.

## Modalità dimostrativa

Il frontend e il backend simulato non verificano transazioni blockchain e non inviano fondi. Il database locale del browser non sincronizza dispositivi; la condivisione tra browser inizierà quando `RENDER_API_BASE` verrà collegato al servizio reale.
