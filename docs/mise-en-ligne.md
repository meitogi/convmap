# Mettre Conv'Map en ligne sur convmap.suuuper.app

La page est publiée par GitHub Pages et servie sous `convmap.suuuper.app`,
dont le DNS est chez Cloudflare. Compter une vingtaine de minutes, plus
l'attente du certificat HTTPS.

Étapes vérifiées contre la documentation de GitHub et de Cloudflare en
novembre 2026 ; les libellés entre guillemets sont ceux des deux interfaces,
en anglais.

Les liens directs supposent le dépôt `meitogi/convmap` ; ceux qui pointent
dedans ne répondent qu'une fois l'étape 2 faite.

## 0. Ce qu'il faut avoir

- le compte GitHub `meitogi` et l'accès à la zone `suuuper.app` chez Cloudflare ;
- le dossier du projet, avec ses commits ;
- Node 24 ou plus récent.

## 1. La clé maître et la première copie des données

Depuis le dossier du projet :

```
node scripts/key.mjs
```

La commande crée la clé maître dans `.agenda-key` (jamais commité) et
l'affiche. La garder sous la main pour les étapes 3 et 6.

`snapshot/events.bin`, la copie chiffrée de l'agenda, est déjà dans le dépôt.
Elle n'est à refaire (`node scripts/snapshot.mjs`, 2 à 3 minutes, puis commit)
que si la clé maître a changé.

## 2. Le dépôt GitHub

1. Sur GitHub, [créer un dépôt](https://github.com/new) **public** nommé
   `convmap`, vide (ni README ni licence). GitHub Pages gratuit demande un dépôt public ; les données, elles,
   sont chiffrées.
2. Pousser la branche `main` vers ce dépôt.

La première publication échouera tant que les étapes 3 et 4 ne sont pas
faites : c'est attendu.

Sur [la page du dépôt](https://github.com/meitogi/convmap), la roue dentée à côté de « About » ouvre sa
présentation. À y mettre :

- « Description » : `Les conventions geek autour d'un lieu : éditions passées, annoncées et probables, sur une carte.`
- « Website » : `https://convmap.suuuper.app`
- « Topics » : `conventions`, `geek`, `anime`, `map`, `leaflet`, `github-pages`

## 3. Le secret `AGENDA_KEY`

Dans le dépôt : « Settings » > « Secrets and variables » > « Actions » >
« New repository secret » — [lien direct](https://github.com/meitogi/convmap/settings/secrets/actions/new).

- « Name » : `AGENDA_KEY`
- « Secret » : la clé maître de l'étape 1

Ce secret ne change plus ensuite : les liens d'accès se gèrent depuis la page
`admin.html`, pas ici.

## 4. Activer Pages

Dans le dépôt : « Settings » > « Pages » (section « Code, planning, and
automation ») — [lien direct](https://github.com/meitogi/convmap/settings/pages). Sous « Build and deployment », choisir « GitHub Actions » comme
« Source ».

Puis relancer la publication : onglet « Actions » > workflow « Pages » > « Run
workflow » — [lien direct](https://github.com/meitogi/convmap/actions/workflows/pages.yml). Une fois la coche verte, la page répond à l'adresse provisoire
<https://meitogi.github.io/convmap/>.

## 5. Le domaine

### 5a. Vérifier le domaine côté GitHub (une fois par domaine)

Si `suuuper.app` est déjà vérifié sur le compte — c'est le cas s'il l'a été
pour `ctr.suuuper.app` —, passer à 5b. Pour le savoir : photo de profil >
« Settings » > « Pages » — [lien direct](https://github.com/settings/pages) ; le domaine y figure avec la mention « Verified ».

Sinon, sur cette même page : « Add a domain », saisir `suuuper.app`, puis
créer chez Cloudflare l'enregistrement TXT que GitHub affiche (son nom
commence par `_github-pages-challenge-meitogi`), revenir et cliquer
« Verify ». Garder ce TXT en place : il empêche un autre compte GitHub de
s'approprier un sous-domaine.

### 5b. L'enregistrement DNS chez Cloudflare

Tableau de bord Cloudflare > zone `suuuper.app` > « DNS » > « Records » >
« Add record » — [lien direct](https://dash.cloudflare.com/?to=/:account/:zone/dns/records),
qui demande de choisir le compte puis la zone.

| Champ | Valeur |
|---|---|
| « Type » | `CNAME` |
| « Name » | `convmap` |
| « Target » | `meitogi.github.io` |
| « Proxy status » | **« DNS only »** (nuage gris) |
| « TTL » | « Auto » |

Puis « Save ».

Deux points à respecter :

- la cible est `meitogi.github.io`, **sans** le nom du dépôt ;
- le nuage doit rester gris. En « Proxied » (nuage orange), GitHub ne voit
  plus le domaine pointer chez lui et ne peut ni émettre ni renouveler le
  certificat HTTPS. C'est le même réglage que pour `ctr.suuuper.app`.

Contrôle, depuis un terminal :

```
dig +short convmap.suuuper.app
```

La première ligne doit être `meitogi.github.io.`, suivie d'adresses en
`185.199.`.

### 5c. Déclarer le domaine dans le dépôt

Dans le dépôt : « Settings » > « Pages » > « Custom domain »
([lien direct](https://github.com/meitogi/convmap/settings/pages)) : saisir
`convmap.suuuper.app`, puis « Save ».

GitHub contrôle le DNS (« DNS check successful »), puis demande le
certificat. Quand la case « Enforce HTTPS » devient cochable — quelques
minutes en général, jusqu'à 24 heures d'après GitHub —, la cocher.

Aucun fichier `CNAME` n'est nécessaire dans le dépôt : la publication passe
par un workflow GitHub Actions, et dans ce cas GitHub n'en lit pas.

## 6. Le jeton de la page d'accès

`admin.html` enregistre la liste des liens par un commit ; il lui faut un
jeton limité à ce seul dépôt.

Photo de profil > « Settings » > « Developer settings » > « Personal access
tokens » > « Fine-grained tokens » > « Generate new token » —
[lien direct](https://github.com/settings/personal-access-tokens/new).

- « Repository access » : « Only select repositories » > `convmap`
- « Permissions » > « Repository permissions » > « Contents » : « Read and write »
- une date d'expiration au choix ; à l'expiration, en créer un nouveau et le
  ressaisir dans `admin.html`

Copier le jeton : GitHub ne le montre qu'une fois.

## 7. Essayer

1. Ouvrir <https://convmap.suuuper.app/> sans rien après : la page doit dire
   qu'elle s'ouvre avec son lien d'accès, et n'afficher aucun évènement.
2. Ouvrir `https://convmap.suuuper.app/#k=<clé maître>` : les évènements
   s'affichent.
3. Ouvrir `https://convmap.suuuper.app/admin.html#k=<clé maître>`, saisir le
   dépôt (`meitogi/convmap`) et le jeton, puis « Enregistrer et charger la
   liste ».
4. « Ajouter un lien » pour un nom d'essai. Un commit « Add an access link »
   apparaît dans le dépôt et une publication démarre
   ([onglet « Actions »](https://github.com/meitogi/convmap/actions)).
5. Une fois la publication verte, ouvrir le lien d'essai dans une fenêtre de
   navigation privée : les évènements s'affichent.
6. « Révoquer » ce lien, attendre la publication suivante, recharger la
   fenêtre privée : la page dit que le lien n'est plus valide.

## Essayer la page d'accès avant la mise en ligne

Le dépôt GitHub et le jeton (étapes 2, 3 et 6) suffisent ; le domaine n'est
pas nécessaire.

```
npm run preview
```

La commande assemble le site tel qu'il sera publié, le sert sur le port 4181
et affiche les deux adresses à ouvrir, clé maître comprise. Dans un
devcontainer, relayer le port 4181 (panneau « Ports » de VS Code > « Forward a
Port »).

Sur `admin.html`, saisir `meitogi/convmap` et le jeton : ajouter et révoquer
écrivent réellement dans le dépôt. Pour voir l'effet d'un ajout ou d'une
révocation sur la page servie en local, récupérer le commit puis relancer la
commande :

```
git pull
npm run preview
```

## Quand ça ne marche pas

| Ce qu'on voit | Cause probable |
|---|---|
| Le workflow échoue à « Build » avec « No master key » | le secret `AGENDA_KEY` manque ou est mal nommé (étape 3) |
| Le workflow échoue avec « wrong key » | le secret ne correspond pas à la clé qui a chiffré `snapshot/events.bin` |
| « DNS check unsuccessful » dans « Settings » > « Pages » | l'enregistrement n'est pas un CNAME vers `meitogi.github.io`, ou il est en « Proxied » |
| « Enforce HTTPS » reste grisé | le certificat n'est pas encore émis ; vérifier que le nuage est gris, puis patienter |
| `admin.html` : « GitHub refuse le jeton » | jeton expiré, ou sans « Contents : Read and write » sur ce dépôt |
| `admin.html` : « La clé maître ne correspond pas » | la clé saisie n'est pas celle du secret |
| Un lien tout juste créé dit « plus valide » | la publication n'est pas terminée : attendre la coche verte dans « Actions » |
