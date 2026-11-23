# agenda-geek

Trouver les évènements geek autour d'un lieu — éditions passées, annoncées et
probables — et en sortir une liste à donner à quelqu'un.

Les données viennent de l'API publique de [lagendageek.com](https://lagendageek.com),
dont les filtres par lieu, par date et par évènement vivent sur trois pages
différentes. Ici tout est au même endroit, et les éditions d'un même évènement
sont regroupées.

## Lancer

```
npm start
```

Puis ouvrir http://localhost:4180. Node 24 ou plus récent, aucune dépendance à
installer. `PORT=8093 npm start` pour un autre port.

Au premier lancement la base est vide : cliquer **Mettre à jour depuis
l'agenda** (2 à 3 minutes, une cinquantaine de requêtes espacées).

## Ce que fait la page

- **Lieu + rayon** — taper une ville ou cliquer sur la carte, régler le rayon.
- **Séries** — une ligne par évènement récurrent, avec toutes ses éditions.
- **Tags**

  | Tag | Règle |
  |---|---|
  | régulier | des éditions sur au moins deux années |
  | nouveau | une seule année, à venir ou datant de moins de 12 mois |
  | en pause ? | régulier, mais plus rien depuis 18 mois et rien d'annoncé |
  | ponctuel | le reste |

- **Édition probable** — un évènement régulier sans date annoncée reçoit un
  mois probable (le mois médian de ses éditions, reporté sur l'année à venir).
  C'est une extrapolation : elle est toujours libellée « non annoncé ».
- **Période** — « à venir : annoncé ou probable » avec « à partir de » répond
  à la question « qu'est-ce qu'il y aura dans le coin après telle date ? ».
- **Recherches enregistrées** — lieu, rayon et filtres sous un nom, à rappeler
  d'un clic.
- **Ajouter / Modifier** — un évènement ajouté à la main, ou un champ corrigé
  sur un évènement de l'agenda, n'est jamais écrasé par une mise à jour.
- **Exporter** — les lignes cochées (ou toutes les lignes affichées si rien
  n'est coché), en quatre formats :
  - texte brut pour un SMS ou un mail ;
  - texte tabulé : collé dans Excel, Numbers ou Sheets, il remplit les colonnes ;
  - Markdown ;
  - CSV (point-virgule, UTF-8 avec BOM).

  Les contacts des organisateurs ne sortent que si la case est cochée.

## Mise à jour depuis l'agenda

Les évènements sont rapprochés par leur identifiant d'agenda. Une mise à jour :

- rafraîchit les champs venus de l'agenda ;
- ne touche ni aux corrections, ni aux notes, ni aux évènements ajoutés à la main ;
- garde un évènement disparu de l'agenda, marqué « retiré de l'agenda » ;
- ne change rien du tout si une page de l'agenda échoue après trois essais.

## Données

`data/agenda.db` (SQLite, hors git — il contient des contacts d'organisateurs).

| Table | Contenu |
|---|---|
| `events` | un évènement daté, venu de l'agenda (`source_id`) ou ajouté à la main ; `overrides` porte les champs corrigés, `gone_at` la date de disparition |
| `searches` | les recherches enregistrées |
| `meta` | date de la dernière lecture de l'agenda |

Les séries ne sont pas stockées : elles sont recalculées à partir de `events`
(même titre une fois l'année et le numéro d'édition retirés, lieux à moins de
50 km). `events.id` est stable : c'est la clé à laquelle un futur suivi de
demandes pourra se rattacher.

## Limites

- L'agenda ne remonte pas avant novembre 2022.
- Deux éditions d'un même évènement à plus de 50 km l'une de l'autre sont
  comptées comme deux séries.
- Un évènement sans coordonnées est listé à part, hors rayon, jusqu'à ce qu'on
  lui donne une latitude et une longitude via « Modifier ».
- Les cases cochées sont gardées par le navigateur, pas par la base.

## Tests

```
npm test
```

## Licences

Carte : [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause, dans
`public/vendor/leaflet/`), fond de carte © les contributeurs d'OpenStreetMap.
