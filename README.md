# ServiceNotes

Offline-Einsatzdokumentation für den Außendienst. Läuft im Browser (iPad, Surface, Laptop) und lässt sich als App auf den Home-Bildschirm legen.

**Alle Daten bleiben lokal auf dem Gerät.** In diesem Repo liegt nur der Programmcode – keine Kundendaten, keine Fotos, keine Berichte.

## Auf dem iPad installieren
1. Die GitHub-Pages-Adresse dieses Repos in **Safari** öffnen.
2. **Teilen → „Zum Home-Bildschirm“** tippen.
3. ServiceNotes ab jetzt über das Icon starten. Funktioniert danach auch ohne Internet.

## Ablauf
Einsatz anlegen → Ankunft / Arbeitsbeginn stempeln → Geräte (Import aus CE-Excel/CSV) → Checkliste pro Gerät (Schritte nacheinander, Foto-Pflicht bei Abweichungen) → Übergabe-Check → Unterschrift vor Ort → PDF-Bericht + CSV für den CE-Flow.

## Stand
Version 0.1 – **Demo-Checklisten**. Echte Checklisten, Flow-Statustexte und CE-Spaltennamen folgen.
Nur mit erfundenen Testdaten verwenden, bis der Einsatz offiziell freigegeben ist.

## Update einspielen
Bei Änderungen `VERSION` in `sw.js` erhöhen, sonst zeigt das iPad weiter die alte Version aus dem Offline-Speicher.

Verwendete Bibliotheken: [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT), [JSZip](https://github.com/Stuk/jszip) (MIT/GPLv3).
