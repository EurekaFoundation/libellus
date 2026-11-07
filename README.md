# Libellus

**Quaderno digitale libero** per appunti a mano, testo e immagini su una tela infinita.
Un'alternativa libera e gratuita a Microsoft OneNote e Apple Freeform.

*Libellus*, in latino, è il "libretto": il piccolo quaderno personale.

## Scaricare e installare

Vai alla pagina **[Releases](../../releases/latest)** e scarica il file per il tuo computer:

| Sistema | File |
|---|---|
| Windows | il file che finisce con `-setup.exe` |
| macOS | il file `.dmg` |
| Linux | il file `.AppImage`, oppure `.deb` per Ubuntu, Debian e Mint |

Aprilo con un doppio clic e segui le istruzioni. Libellus funziona anche **senza internet** e salva tutto sul tuo computer.

Al primo avvio il sistema può avvisare che il programma viene da uno sviluppatore sconosciuto, perché non è firmato
con un certificato a pagamento:
su **Windows** clicca *Ulteriori informazioni* › *Esegui comunque*; su **macOS** tasto destro su Libellus › *Apri* › *Apri*.

Non vuoi installare niente? Scarica `libellus.html` dalla stessa pagina e aprilo nel browser.

## Perché

- **Struttura a quaderni**: quaderni, pagine e una tela infinita in ogni pagina.
- **Scrittura a mano** con mouse, penna (pressione inclusa) o dito.
- **I tuoi dati restano tuoi**: tutto è salvato sul tuo dispositivo. Nessun account, nessun cloud obbligatorio.
- **Formato aperto**: i quaderni si esportano in un file `.libellus` (un normale ZIP con JSON e immagini), leggibile anche senza Libellus.
- **Gira ovunque**: programma per Windows, macOS e Linux, oppure nel browser su qualsiasi dispositivo.

## Funzioni

| Strumento | Tasto | Cosa fa |
|---|---|---|
| Penna | `P` | Tratto morbido; con una penna vera usa la pressione |
| Evidenziatore | `H` | Tratto trasparente che non copre il testo |
| Gomma | `E` | Cancella i tratti su cui passa |
| Testo | `T` | Clic sul foglio per scrivere; `Esc` per confermare |
| Forme | `S` | Linea, freccia, rettangolo, ellisse; con `Maiusc` linee a 45°, quadrati e cerchi |
| Selezione | `V` | Clic o rettangolo; trascina per spostare, gli angoli per ridimensionare, `Canc` per eliminare, `Ctrl D` per duplicare |
| Sposta il foglio | `Spazio` + trascina | Anche col tasto centrale o destro del mouse |

**Forme a mano libera**: disegna con la penna una linea, un cerchio, un rettangolo o un triangolo e,
alla fine, tieni fermo il puntatore per mezzo secondo: il tratto diventa una forma pulita.

**PDF**: con il pulsante PDF (o trascinando il file sul foglio) le pagine diventano immagini fissate al foglio,
su cui scrivere ed evidenziare. Il loro testo resta ricercabile. Per spostarle: menu della pagina › *Sblocca elementi fissati*.
Qualsiasi immagine si può fissare al foglio dalla barra della selezione.

**Ricerca** (`Ctrl F`): cerca nei titoli delle pagine, nei testi e nei PDF di tutti i quaderni, e porta all'elemento trovato.
La scrittura a mano non è ancora ricercabile.

Inoltre: zoom con `Ctrl` + rotella, annulla e ripeti (`Ctrl Z`, `Ctrl Y`), immagini incollate con `Ctrl V` o trascinate sul foglio, fogli bianchi, a righe, a quadretti da 5 mm o a puntini, esportazione della pagina in PNG, esportazione e importazione dei quaderni.

## Per chi sviluppa

Serve [Node.js](https://nodejs.org) 18 o successivo.

```bash
npm install
npm run dev          # apre l'app su http://localhost:5173
```

Per avere un solo file da aprire con un doppio clic, senza server:

```bash
npm run build:single # crea dist-single/index.html
```

Per pubblicarlo su un sito qualsiasi (anche GitHub Pages):

```bash
npm run build        # crea la cartella dist/
```

### Versione desktop

Il programma desktop usa [Tauri](https://tauri.app): la stessa app in una finestra propria, leggera (pochi MB).
Per compilarlo sul proprio computer servono anche [Rust](https://rustup.rs) e i
[prerequisiti di Tauri](https://tauri.app/start/prerequisites/).

```bash
npm run desktop        # avvia il programma in modalità sviluppo
npm run desktop:build  # crea l'installatore in src-tauri/target/release/bundle/
```

Non è necessario farlo a mano: alla pubblicazione di una release, GitHub Actions costruisce da solo gli installatori
per tutti i sistemi. Vedi [PUBBLICARE.md](PUBBLICARE.md).

## Struttura del codice

```
src-tauri/      programma desktop (Tauri): configurazione, icone, permessi
.github/        costruzione automatica degli installatori
src/
  main.ts       interfaccia: barra laterale, strumenti, menu, scorciatoie
  board.ts      la tela: disegno, gomma, selezione, testo, zoom, annulla/ripeti
  model.ts      tipi dei dati (quaderni, pagine, tratti, testi, immagini)
  store.ts      salvataggio locale in IndexedDB
  exporter.ts   formato .libellus ed esportazione PNG
  geometry.ts   ingombri e collisioni degli elementi
  recognize.ts  riconoscimento delle forme disegnate a mano
  pdf.ts        importazione dei PDF
  search.ts     ricerca nei quaderni
  platform.ts   differenze tra browser e programma desktop (salvataggio file)
  welcome.ts    quaderno di benvenuto al primo avvio
  icons.ts      icone
  styles.css    stile, con tema chiaro e scuro
```

Il codice è TypeScript senza framework. Le sole dipendenze sono
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) (tratti a mano, MIT),
[fflate](https://github.com/101arrowz/fflate) (ZIP, MIT) e
[pdf.js](https://github.com/mozilla/pdf.js) (PDF, Apache 2.0, caricato solo quando si importa un PDF). I caratteri Cinzel e
Atkinson Hyperlegible (licenza OFL) sono inclusi nell'app: nessuna richiesta a server esterni.

## Il formato `.libellus`

```
manifest.json        { "format": "libellus", "version": 1, "notebook": {...}, "pages": [...] }
pages/<id>.json      una pagina con i suoi elementi (stroke, text, image, shape)
assets/<id>.png      le immagini
```

Ogni tratto è una lista di punti `[x, y, pressione]`. Le coordinate sono in pixel a zoom 100%.

## Prossimi passi

- [x] Ridimensionare immagini e selezioni
- [x] Importare PDF e scriverci sopra
- [x] Cerca nel testo di tutti i quaderni
- [x] Forme e riconoscimento delle forme a mano
- [ ] Ruotare le selezioni
- [ ] Esportare una pagina annotata in PDF
- [ ] Riconoscimento della scrittura a mano, per renderla ricercabile
- [x] Versione desktop installabile con Tauri
- [ ] Copia di sicurezza automatica dei quaderni
- [ ] Aggiornamenti automatici del programma
- [ ] Sincronizzazione facoltativa via WebDAV o Nextcloud, o con un piccolo server da ospitare in proprio
- [ ] Traduzioni

## Contribuire

Segnalazioni, idee e pull request sono benvenute. Prima di una modifica grande, apri una issue per parlarne.

## Licenza

Libellus è software libero: puoi usarlo, studiarlo, modificarlo e ridistribuirlo secondo i termini della
[GNU General Public License v3.0 o successiva](LICENSE).
