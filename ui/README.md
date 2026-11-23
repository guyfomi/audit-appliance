# Interface Web — Oracle Data Audit & Forensics Appliance

## Stack technique

| Composant | Version | Usage |
|-----------|---------|-------|
| React | 18.3 | Framework UI |
| TypeScript | 5.4 | Typage statique |
| Material UI (MUI) | 5.15 | Composants UI |
| AG Grid Community | 31 | Tableau haute performance |
| Apache ECharts | 5.5 | Graphiques |
| React Query | 5.40 | Cache serveur + polling |
| React Router | 6.23 | Navigation SPA |
| Axios | 1.7 | Client HTTP |
| Vite | 5.3 | Bundler |

## Structure des fichiers

```
ui/src/
├── main.tsx                    ← Point d'entrée React
├── App.tsx                     ← Routing + thème + providers
│
├── lib/
│   ├── types.ts                ← Interfaces TypeScript (CDCStatus, AuditEvent…)
│   └── api.ts                  ← Client HTTP (axios + intercepteurs JWT)
│
├── contexts/
│   └── AuthContext.tsx         ← JWT, login/logout, hasRole()
│
├── hooks/
│   └── index.ts                ← Tous les hooks React Query
│
├── components/
│   ├── common/
│   │   └── index.tsx           ← RiskBadge, OperationBadge, BeforeAfterDiff, Pagination…
│   └── layout/
│       └── Shell.tsx           ← Sidebar + main area + CDC status
│
└── pages/
    ├── Login.tsx               ← Page de connexion
    ├── Dashboard.tsx           ← KPIs + graphiques ECharts
    ├── AuditExplorer.tsx       ← AG Grid + filtres + drawer détail
    ├── EventDetail.tsx         ← Détail complet + diff avant/après + raisons risque
    ├── RecordTimeline.tsx      ← Timeline MUI + historique enregistrement
    ├── Alerts.tsx              ← Gestion des alertes de sécurité
    └── Health.tsx              ← Santé système + ressources
```

## Installation (production)

```bash
# Sur la VM appliance (en tant que root)
sudo bash install/install-ui.sh

# Ou manuellement :
cd /opt/audit-appliance/ui
npm ci
npm run build
sudo systemctl reload nginx
```

## Développement local

```bash
cd ui

# Installer les dépendances
npm install

# Démarrer le serveur de développement
# L'API est proxifiée depuis http://localhost:8000
npm run dev
# → http://localhost:3000

# Vérification TypeScript
npm run type-check

# Linting
npm run lint

# Build production
npm run build
```

## Proxy API en développement

Le fichier `vite.config.ts` configure un proxy :

```
http://localhost:3000/api/* → http://localhost:8000/api/*
```

L'appliance doit tourner en local ou être accessible via tunnel SSH :

```bash
# Tunnel SSH vers la VM appliance
ssh -L 8000:localhost:8000 audit@vm-appliance
```

## Pages disponibles

| Route | Composant | Description |
|-------|-----------|-------------|
| `/login` | Login | Authentification JWT |
| `/dashboard` | Dashboard | KPIs, graphiques, top tables/users |
| `/explorer` | AuditExplorer | Recherche avec AG Grid + filtres |
| `/timeline` | RecordTimeline | Historique d'un enregistrement |
| `/transactions` | Placeholder | Explorer les transactions |
| `/alerts` | Alerts | Gestion des alertes de sécurité |
| `/rules` | Placeholder | Règles de risque |
| `/databases` | Placeholder | Bases Oracle configurées |
| `/integrity` | Placeholder | Vérification chaîne SHA-256 |
| `/archive` | Placeholder | Jobs d'archivage |
| `/health` | Health | Santé système détaillée |
| `/reports` | Placeholder | Génération de rapports |
| `/users` | Placeholder | Gestion utilisateurs |
| `/backup` | Placeholder | Backup / Restore |
| `/admin` | Placeholder | Administration |

Les pages marquées *Placeholder* ont leur structure définie —
implémenter en suivant le pattern de `AuditExplorer.tsx`.

## Composants clés

### `BeforeAfterDiff`

```tsx
<BeforeAfterDiff
  before={{ STATUS: "ACTIVE", CREDIT_LIMIT: 5000000 }}
  after={{  STATUS: "ACTIVE", CREDIT_LIMIT: 8000000 }}
  changedColumns={["CREDIT_LIMIT"]}
  showAll={false}
/>
```

Affiche un tableau comparatif avant/après avec :
- Colonnes modifiées en surbrillance jaune
- Valeurs barrées à gauche, nouvelles valeurs à droite
- Badge de variation en % pour les valeurs numériques
- Bouton "Voir toutes les colonnes" pour afficher les colonnes inchangées

### `RiskBadge`

```tsx
<RiskBadge level="CRITICAL" score={87} />
// → Chip rouge "CRITICAL (87)"
```

### `CDCStatusBadge`

```tsx
<CDCStatusBadge status={cdcStatus} />
// → Pastille verte + "CDC RUNNING · lag 0.4s"
```

### Hooks React Query

```tsx
// Dashboard (polling 10s)
const { data: stats } = useDashboard();

// Recherche d'événements avec filtres
const { data, isLoading } = useEventSearch(params);

// Détail d'un événement
const { data: event } = useEventDetail(eventId);

// Timeline d'un enregistrement
const { data: timeline } = useRecordTimeline('BANK', 'CUSTOMER', '123456');

// Alertes ouvertes (polling 30s)
const { data: alerts } = useAlerts('OPEN');

// Statut CDC (polling 10s)
const { data: cdc } = useCDCStatus();
```

## RBAC dans l'UI

```tsx
const { hasRole } = useAuth();

// Afficher un élément uniquement pour ADMIN
{hasRole('ADMIN') && <Button>Supprimer</Button>}

// Vérifier plusieurs rôles
{hasRole('ADMIN', 'AUDITOR') && <IntegrityVerifyButton />}
```

Rôles : `ADMIN > AUDITOR > ANALYST > READONLY`

## Variables d'environnement

Créer un fichier `.env.local` pour le développement :

```bash
# .env.local (jamais committer)
VITE_API_BASE_URL=/api/v1
VITE_APP_TITLE=Oracle Data Audit (DEV)
VITE_APP_VERSION=1.0.0-dev
```

## Build et optimisations

Le build Vite génère des chunks séparés :

```
dist/
├── index.html
└── assets/
    ├── vendor-[hash].js      ← React + Router
    ├── mui-[hash].js         ← Material UI
    ├── aggrid-[hash].js      ← AG Grid
    ├── echarts-[hash].js     ← ECharts
    └── index-[hash].js       ← Code applicatif
```

Taille approximative du build (gzip) :
- `vendor` : ~45 KB
- `mui`    : ~120 KB
- `aggrid` : ~180 KB
- `echarts`: ~95 KB
- `index`  : ~25 KB

## Ajout d'une nouvelle page

1. Créer `ui/src/pages/MaPage.tsx`
2. Ajouter la route dans `App.tsx` :
   ```tsx
   <Route path="ma-page" element={<MaPage />} />
   ```
3. Ajouter l'entrée dans le menu `Shell.tsx` (`NAV_ITEMS`)
4. Optionnel : ajouter un hook dans `hooks/index.ts`
