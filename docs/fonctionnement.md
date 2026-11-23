# Conv'Map — fonctionnement

Le détail de ce que fait la page, de ses deux versions et de ses données.
Pour publier le site : [mise-en-ligne.md](mise-en-ligne.md).

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
- **Thème** — clair ou sombre, par l'icône en haut à droite ; celui du système
  au premier lancement.
- **Version et nouveautés** — le numéro de version est en bas de la liste ; un
  clic affiche les nouveautés, lues dans `CHANGELOG.md`. Pour publier une
  version : ajouter son titre et ses lignes en haut de ce fichier, et mettre
  le même numéro dans `package.json` (un test vérifie qu'ils concordent).
- **Sur téléphone** — le lieu et les filtres se replient derrière un bouton
  et valent pour les deux vues ; juste en dessous, une bascule choisit entre
  la liste et la carte ; les
  menus s'ouvrent en bas de l'écran ; toucher un point de la carte affiche
  l'évènement dans une fiche par-dessus la carte.
- **Contacts** — une icône par moyen de contact. E-mail et téléphone ouvrent
  un petit menu : la valeur, « Envoyer un mail » ou « Appeler », et « Copier »,
  dont le bouton confirme lui-même la copie.
- **Facebook et Instagram** — lus dans ce que l'agenda publie pour chaque
  évènement (site, site de l'organisateur, champs libres, description en
  dernier recours). Une page Facebook est préférée à un lien d'évènement.
- **Recherches partageables** — l'adresse de la page suit les filtres
  (`?lieu=Rennes&rayon=150&periode=upcoming…`). La copier, ou cliquer « Copier
  le lien », donne un lien qui rouvre la même recherche. Ce lien ne contient
  jamais de clé d'accès : dans la version en ligne, son destinataire doit
  avoir son propre accès. Pour envoyer quelqu'un directement sur une
  recherche avec son accès, placer la partie `?…` avant le `#k=` de son lien.
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
  `https://convmap.suuuper.app/#k=<clé>`. Ce qui suit le `#` reste dans
  le navigateur, il n'est jamais envoyé à GitHub. À l'ouverture du lien, le
  navigateur retient la clé et la retire aussitôt de la barre d'adresse.
- **Un lien par personne.** La page `admin.html` liste les liens, en crée un
  pour un nom, en révoque un ; elle lance aussi la mise à jour des données. Un lien révoqué cesse de fonctionner à la
  publication suivante, une à deux minutes plus tard.
- **Ce que chacun ajoute reste chez lui.** Évènements ajoutés, corrections,
  notes et recherches enregistrées vivent dans le navigateur du visiteur
  (IndexedDB), pas dans le dépôt.
- Pour rafraîchir sans attendre le lundi : le bouton « Mettre à jour depuis
  l'agenda » de `admin.html`, ou `npm run update` puis un push.

La marche à suivre complète — dépôt, secret, domaine `convmap.suuuper.app`
chez Cloudflare, jeton, essai de la page d'accès — est dans
[mise-en-ligne.md](mise-en-ligne.md). En résumé :

### Mise en place, une fois

1. `node scripts/key.mjs` crée la clé maître (fichier `.agenda-key`, hors
   git) et affiche le lien maître.
2. `npm run update` écrit la première copie chiffrée et la commite.
3. Sur GitHub : créer le dépôt, pousser, ajouter la clé maître comme secret
   `AGENDA_KEY` (Settings > Secrets and variables > Actions), et choisir
   « GitHub Actions » comme source dans Settings > Pages.
4. Créer un « fine-grained token » limité à ce dépôt, permissions Contents et
   Actions en lecture et écriture, et le saisir dans `admin.html` avec la clé maître.

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
  git. Si elle fuit : `node scripts/key.mjs --new`, refaire la copie (`npm run update`),
  mettre à jour le secret — et recréer les liens, la liste étant scellée avec elle.
- Les réglages de `admin.html` (jeton compris) sont gardés par le navigateur
  où ils ont été saisis : sur un poste partagé, cliquer « Oublier ces
  réglages » après usage.

## Mise à jour depuis l'agenda

La page n'a pas de bouton de mise à jour : les données arrivent par l'un de
ces trois chemins.

| Chemin | Ce qu'il met à jour |
|---|---|
| `npm run update` | la base locale, et la copie chiffrée `snapshot/events.bin`, commitée — un push la publie |
| le bouton de `admin.html` | la copie publiée, tout de suite, en lançant le workflow GitHub |
| le workflow, chaque lundi | la copie publiée |

`npm run update -- --no-commit` laisse la copie non commitée.

Dans tous les cas, les évènements sont rapprochés par leur identifiant
d'agenda, et une mise à jour :

- rafraîchit les champs venus de l'agenda ;
- ne touche ni aux corrections, ni aux notes, ni aux évènements ajoutés à la main ;
- garde un évènement disparu de l'agenda, marqué « retiré de l'agenda » ;
- ne change rien du tout si une page de l'agenda échoue après trois essais ;
- ne produit pas de nouvelle copie si l'agenda n'a pas changé.

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
