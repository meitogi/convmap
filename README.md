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

Dans un devcontainer qui ne relaie aucun port de lui-même, relayer le port à
la main : panneau « Ports » de VS Code > « Forward a Port » > 4180.

Au premier lancement la base est vide : cliquer **Mettre à jour depuis
l'agenda** (2 à 3 minutes, une cinquantaine de requêtes espacées).

## Ce que fait la page

- **Lieu + rayon** — taper une ville, ou « Sur la carte » puis cliquer
  un point ; régler le rayon.
- **Régions et départements** — sélection multiple, seule ou combinée au
  rayon. Le département vient du code postal du lieu ; hors de France, le pays
  tient lieu de région.
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
- **Tri** — par prochaine date, ou par proximité dès qu'un lieu est choisi.
- **Thème** — clair ou sombre ; celui du système au premier lancement.
- **Contacts** — une icône par moyen de contact. E-mail et téléphone ouvrent
  un petit menu : la valeur, « Envoyer un mail » ou « Appeler », et « Copier »,
  dont le bouton confirme lui-même la copie.
- **Facebook et Instagram** — lus dans ce que l'agenda publie pour chaque
  évènement (site, site de l'organisateur, champs libres, description en
  dernier recours). Une page Facebook est préférée à un lien d'évènement.
- **Recherches enregistrées** — lieu, rayon, régions et filtres sous un nom, à rappeler
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

## Version hébergée (GitHub Pages)

La même page, sans serveur : `node scripts/build-site.mjs` l'assemble dans
`_site/`, et le workflow `.github/workflows/pages.yml` la publie à chaque push
sur `main`.

- **Les données partent avec la page.** `snapshot/events.bin` est une copie
  complète de l'agenda : la page s'ouvre tout de suite, et fonctionne encore
  quand l'agenda ne répond pas. Le workflow la rafraîchit chaque lundi ; si
  l'agenda est injoignable ce jour-là, la copie précédente reste en place.
- **Les données sont chiffrées** (AES-256-GCM). Le dépôt et la page sont
  publics, les données ne se lisent qu'avec un lien d'accès :
  `https://<compte>.github.io/<dépôt>/#k=<clé>`. Ce qui suit le `#` reste dans
  le navigateur, il n'est jamais envoyé à GitHub. Une fois le lien ouvert, le
  navigateur retient la clé.
- **Un lien par personne.** La page `admin.html` liste les liens, en crée un
  pour un nom, en révoque un. Un lien révoqué cesse de fonctionner à la
  publication suivante, une à deux minutes plus tard.
- **Ce que chacun ajoute reste chez lui.** Évènements ajoutés, corrections,
  notes et recherches enregistrées vivent dans le navigateur du visiteur
  (IndexedDB), pas dans le dépôt.
- « Mettre à jour depuis l'agenda » lit l'agenda directement depuis le
  navigateur (2 à 3 minutes), sans attendre le lundi.

### Mise en place, une fois

1. `node scripts/key.mjs` crée la clé maître (fichier `.agenda-key`, hors
   git) et affiche le lien maître.
2. `node scripts/snapshot.mjs` écrit la première copie chiffrée ; la commiter.
3. Sur GitHub : créer le dépôt, pousser, ajouter la clé maître comme secret
   `AGENDA_KEY` (Settings > Secrets and variables > Actions), et choisir
   « GitHub Actions » comme source dans Settings > Pages.
4. Créer un « fine-grained token » limité à ce dépôt, permission Contents en
   lecture et écriture, et le saisir dans `admin.html` avec la clé maître.

### Comment les accès tiennent

Le secret GitHub ne contient que la clé maître, et ne change plus : un secret
GitHub s'écrit mais ne se relit pas, il ne peut donc pas servir à lister des
liens. La liste des personnes (nom + clé personnelle) est le fichier
`snapshot/access.bin`, chiffré avec la clé maître ; `admin.html` le lit et le
réécrit par un commit, qui déclenche la publication.

À chaque publication, les données sont rechiffrées avec une clé neuve, et
cette clé est publiée une fois par personne, enveloppée dans sa clé
personnelle (`data/keys.json`, sans aucun nom). Une clé retirée de la liste
n'ouvre donc ni l'enveloppe ni les données suivantes.

Ce que cette protection ne fait pas :

- Quelqu'un qui a eu accès a pu copier ce qu'il voyait ; révoquer ne reprend
  rien, cela coupe la suite.
- La clé maître ouvre tout, y compris les anciennes copies dans l'historique
  git. Si elle fuit : `node scripts/key.mjs --new`, refaire la copie, mettre
  à jour le secret — et recréer les liens, la liste étant scellée avec elle.
- Les réglages de `admin.html` (jeton compris) sont gardés par le navigateur
  pour l'adresse `<compte>.github.io`, que partagent tous les sites Pages du
  même compte : n'y héberger que des pages de confiance, ou cliquer « Oublier
  ces réglages » après usage.

## Mise à jour depuis l'agenda

Les évènements sont rapprochés par leur identifiant d'agenda. Une mise à jour :

- rafraîchit les champs venus de l'agenda ;
- ne touche ni aux corrections, ni aux notes, ni aux évènements ajoutés à la main ;
- garde un évènement disparu de l'agenda, marqué « retiré de l'agenda » ;
- ne change rien du tout si une page de l'agenda échoue après trois essais.

## Données

Version locale : `data/agenda.db` (SQLite, hors git — il contient des contacts d'organisateurs).

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
- Un évènement sans code postal exploitable n'apparaît dans aucune région ni
  aucun département.
- Les champs libres de l'agenda contiennent aussi des adresses e-mail de
  personnes ayant soumis un évènement : elles ne sont pas lues, seuls les
  liens Facebook et Instagram le sont.
- Les cases cochées sont gardées par le navigateur, pas par la base.

## Tests

```
npm test
```

## Licences

Carte : [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause, dans
`public/vendor/leaflet/`), fond de carte © les contributeurs d'OpenStreetMap. Icônes : tracés de
[Feather](https://feathericons.com) (MIT).
