# Bagroom ULD Assignment Tracker

A lightweight, persistent tracker for arranging ULDs across three chute rows (four positions each) and spare parking.

Each chute can be named in Setup using an `MU###` identifier, such as `MU101`.

The Assignment Board can be exported as a PNG floor-layout image using the **Export floor photo** button. Image creation happens locally in the browser.

## Run with Docker Compose

```sh
docker compose up
```

Open [http://localhost:8083](http://localhost:8083). The project directory is mounted into the container, so each new `docker compose up` runs the latest local source without building an image. Data is saved in `data/state.json`.

## Run with NPM

Requires Node.js 22 or newer.

```sh
npm start
```

Open [http://localhost:8083](http://localhost:8083).

## Import format

Paste a plain list to import all ULDs into spare parking, or use section headings to assign positions immediately:

The importer automatically appends `EK` to each ULD number, so `AKE12345` becomes `AKE12345EK`. Numbers already ending in `EK` are left unchanged.

```text
Row 1
QKE70516
AKE92264
AKE47803

Row 2
QKE66306
AKE62338
AKE47988
AKE48667

Row 3
QKE68231
AKE48099
QKE67554
QKE68437

Spare
QKE70473
QKE69558
```

Commodity requirements are imported in Setup using one line per requirement, such as `1 BJ`, `2 BY`, or `3 B2X`. Supported ULD commodity codes are B1A–B4X plus MXT, BJ, BY, B0X, and BTX. Requirements are not displayed on the assignment board.
