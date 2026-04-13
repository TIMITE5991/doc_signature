# DocuSign CGRAE

Plateforme de signature électronique pour la **Caisse Générale de Retraite des Agents de l'État (CGRAE)**.

> ⚠️ Seules les adresses e-mail `@cgrae.ci` sont acceptées pour les comptes utilisateurs et les destinataires.

---

## Prérequis

| Outil | Version minimale |
|-------|-----------------|
| Node.js | 18.x |
| npm | 9.x |
| MySQL | 8.x |
| Angular CLI | 17.x (`npm i -g @angular/cli`) |

---

## Structure du projet

```
doc_signature/
├── backend/              # API REST NestJS
│   ├── src/
│   │   ├── app.module.ts
│   │   ├── main.ts
│   │   ├── common/
│   │   │   └── enums.ts
│   │   ├── database/
│   │   │   ├── schema.sql
│   │   │   ├── seed.ts
│   │   │   ├── database.module.ts
│   │   │   └── database.provider.ts
│   │   ├── auth/
│   │   ├── users/
│   │   ├── documents/
│   │   ├── templates/
│   │   ├── envelopes/
│   │   ├── email/
│   │   ├── audit/
│   │   └── notifications/
│   ├── uploads/          # Fichiers téléversés (créé automatiquement)
│   ├── .env.example
│   └── package.json
└── frontend/             # Application Angular 18
    ├── src/
    │   ├── app/
    │   │   ├── core/
    │   │   │   ├── guards/
    │   │   │   ├── interceptors/
    │   │   │   ├── models/
    │   │   │   └── services/
    │   │   ├── features/
    │   │   │   ├── auth/
    │   │   │   ├── dashboard/
    │   │   │   ├── documents/
    │   │   │   ├── envelopes/
    │   │   │   ├── templates/
    │   │   │   ├── signing/
    │   │   │   ├── users/
    │   │   │   ├── audit/
    │   │   │   ├── notifications/
    │   │   │   └── profile/
    │   │   └── layout/
    │   │       ├── header/
    │   │       ├── sidebar/
    │   │       └── shell/
    │   ├── environments/
    │   └── styles.scss
    ├── proxy.conf.json
    └── package.json
```

---

## Installation & démarrage

### 1. Base de données MySQL

```sql
CREATE DATABASE docsign_cgrae CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Importer le schéma :

```bash
mysql -u root -p docsign_cgrae < backend/src/database/schema.sql
```

### 2. Backend

```bash
cd backend

# Installer les dépendances
npm install

# Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos paramètres MySQL et SMTP

# Insérer les données de démarrage
npm run seed

# Démarrer en mode développement
npm run start:dev
```

L'API sera disponible sur **http://localhost:3000**  
Documentation Swagger : **http://localhost:3000/docs**

### 3. Frontend

```bash
cd frontend

# Installer les dépendances
npm install

# Démarrer le serveur de développement
ng serve
# ou
npm start
```

L'application sera disponible sur **http://localhost:4200**

---

## Variables d'environnement (`.env`)

```env
# Serveur
PORT=3000
NODE_ENV=development

# Base de données
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=votre_mot_de_passe
DB_NAME=docsign_cgrae

# JWT
JWT_SECRET=votre_cle_secrete_tres_longue_et_aleatoire
JWT_EXPIRATION=24h

# SMTP (exemple Mailhog pour dev)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=DocuSign CGRAE <noreply@cgrae.ci>

# CORS
CORS_ORIGIN=http://localhost:4200

# Upload
UPLOAD_DEST=./uploads
MAX_FILE_SIZE=10485760
```

---

## Comptes de démonstration (après `npm run seed`)

| E-mail | Mot de passe | Rôle |
|--------|-------------|------|
| `admin@cgrae.ci` | `Admin1234!` | Super Admin |
| `it.admin@cgrae.ci` | `Admin1234!` | Administrateur |
| `dg@cgrae.ci` | `User1234!` | Signataire |
| `juridique@cgrae.ci` | `User1234!` | Approbateur |

---

## Endpoints API principaux

### Authentification
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/auth/login` | Connexion, retourne un JWT |
| POST | `/auth/register` | Création de compte (`@cgrae.ci` obligatoire) |
| GET | `/auth/profile` | Profil de l'utilisateur connecté |

### Enveloppes
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/envelopes` | Lister ses enveloppes |
| POST | `/envelopes` | Créer une enveloppe |
| POST | `/envelopes/:id/send` | Envoyer aux destinataires |
| POST | `/envelopes/:id/cancel` | Annuler |
| GET | `/envelopes/sign/:token` | Récupérer les infos de signature (public) |
| POST | `/envelopes/sign/:token/confirm` | Signer (public) |
| POST | `/envelopes/sign/:token/reject` | Rejeter (public) |
| POST | `/envelopes/sign/:token/delegate` | Déléguer (public) |

### Signature publique

Les liens de signature sont de la forme :

```
http://localhost:4200/sign/<token_unique_par_destinataire>
```

Ils sont envoyés par e-mail et ne nécessitent **pas** d'être connecté.

---

## Fonctionnalités

- **Circuit séquentiel** : les signataires signent dans l'ordre défini — chaque suivant reçoit l'email uniquement après la signature du précédent.
- **Circuit parallèle** : tous les destinataires reçoivent le document simultanément.
- **Délégation** : un signataire peut déléguer sa signature à une autre personne (`@cgrae.ci`).
- **Piste d'audit** : chaque action (création, envoi, signature, rejet, annulation) est horodatée et tracée.
- **Notifications** : les utilisateurs reçoivent des notifications in-app pour chaque événement les concernant.
- **Gestion documentaire** : téléversement de PDF, DOCX, XLSX, images (max 10 MB).
- **Modèles** : créez des gabarits réutilisables pour vos circuits de signature.

---

## Scripts disponibles

### Backend

| Commande | Description |
|----------|-------------|
| `npm run start:dev` | Démarrage en mode watch |
| `npm run start:prod` | Démarrage en production |
| `npm run build` | Compilation TypeScript |
| `npm run seed` | Insertion des données initiales |

### Frontend

| Commande | Description |
|----------|-------------|
| `ng serve` | Serveur de développement (avec proxy) |
| `ng build` | Build de production (`dist/`) |
| `ng build --configuration production` | Build optimisé |

---

## Rôles utilisateurs

| Rôle | Permissions |
|------|------------|
| `SUPER_ADMIN` | Accès total, gestion des utilisateurs |
| `ADMIN` | Gestion des utilisateurs, audit global |
| `SIGNATORY` | Créer et signer des enveloppes |
| `APPROVER` | Approuver des documents |

---

## Technologies

**Backend :** NestJS 10 · Knex 3 · MySQL2 · Passport/JWT · Nodemailer · Multer · Swagger  
**Frontend :** Angular 18 · TypeScript · SCSS · RxJS 7 · Angular Signals
