// Gegenleistungs-Karten. s: true = pikant (auf dem Heute-Screen verschleiert, per Schalter ausblendbar)
const STAGES = {
  1: { name: 'Stufe 1', label: 'Kleinigkeit', hint: 'schnell erledigt, eher Geste' },
  2: { name: 'Stufe 2', label: 'Einsatz', hint: 'kostet einen Abend oder etwas Überwindung' },
  3: { name: 'Stufe 3', label: 'Hardcore', hint: 'gewagt, neu oder besonders hingebungsvoll' },
  4: { name: 'Stufe 4', label: 'Boss-Level', hint: 'das volle Programm' },
  team: { name: 'Team', label: 'Team-Belohnung', hint: 'für euch beide' },
};
const CARDS = {
  1: [
    { t: 'Ein Kuss-Gutschein: 24 Stunden lang auf Zuruf einlösbar – wo und wie lange, bestimmt der Gewinner.', s: true },
    { t: 'Heute Abend flüstert der Verlierer dem Gewinner ins Ohr, was er gern mal mit ihm anstellen würde.', s: true },
    { t: 'Ein versteckter Zettel mit einer ehrlichen Ansage für später. Der Gewinner muss ihn erst finden.', s: true },
    { t: 'Zehn Minuten Streicheleinheiten, der Gewinner bestimmt, wo.', s: true },
  ],
  2: [
    { t: '20 Minuten Massage mit Öl. Der Gewinner bestimmt Tempo und Körperregion – wohin das führt, ist offen.', s: true },
    { t: 'Strip-Tease zu einem Song, den der Gewinner aussucht.', s: true },
    { t: 'Der Gewinner entscheidet, was der Verlierer heute Abend trägt – oder eben nicht.', s: true },
    { t: 'Frei gestaltbar: Der Gewinner formuliert einen Wunsch für heute Abend, der Verlierer setzt ihn um.', s: true },
  ],
  3: [
    { t: 'Etwas Neues ausprobieren: eine Stellung, ein Ort in der Wohnung oder ein Spielzeug, das bisher nur Gesprächsthema war.', s: true },
    { t: 'Rollenspiel: Der Gewinner denkt sich die Rollen aus, der Verlierer bleibt eine Stunde lang drin.', s: true },
    { t: 'Augenbinde-Abend: Der Gewinner sieht nichts und lässt sich komplett überraschen.', s: true },
    { t: 'Ein Abend, an dem der Gewinner das Kommando hat: was, wie und wie lange.', s: true },
  ],
  4: [
    { t: 'Eine Fantasie des Gewinners, die schon länger im Kopf herumspukt, wird Wirklichkeit. Details sprecht ihr vorher ab.', s: true },
    { t: 'Verführungsnacht: Der Verlierer inszeniert alles – Licht, Musik, Outfit, Ablauf. Der Gewinner muss sich nur fallen lassen.', s: true },
    { t: 'Frei gestaltbar: Der Gewinner schreibt das Drehbuch für einen ganzen Abend, der Verlierer spielt mit.', s: true },
  ],
  team: [
    { t: 'Jeder schreibt heimlich drei Dinge auf, die er gern ausprobieren würde. Was auf beiden Zetteln steht, wird diese Woche eingelöst.', s: true },
    { t: 'Gemeinsam ein neues Spielzeug oder Spiel fürs Schlafzimmer aussuchen und direkt testen.', s: true },
    { t: 'Ein Abend ohne Handys und ohne Plan, Tür zu – nur ihr beide und so viel Zeit, wie ihr braucht.', s: true },
    { t: 'Eine Nacht auswärts, Hotel oder Ferienwohnung, nur für euch zwei.', s: true },
  ],
};
