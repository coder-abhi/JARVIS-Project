Follow below code struture for this project

jarvis/
│
├── apps/ (Keep UI Dark Mode Theme)
│   └── desktop/
│       └── src/
│           ├── app/
│           │   ├── App.tsx
│           │   ├── routes.tsx
│           │   └── featureRegistry.ts
│           │
│           ├── features/
│           │   ├── `<feature 1 name>`/
│           │   │   ├── feature.config.ts
│           │   │   ├── routes.tsx
│           │   │   ├── sidebar.ts
│           │   │   ├── pages/
│           │   │   ├── components/
│           │   │   ├── api.ts
│           │   │   ├── types.ts
│           │   │
│           │   │
│           │   ├── <feature 2 name>/
│           │   │   ├── feature.config.ts
│           │   │   ├── routes.tsx
│           │   │   ├── sidebar.ts
│           │   │   ├── pages/
│           │   │   ├── components/
│           │   │   ├── api.ts
│           │   │   ├── types.ts
│           │   │
│           │
│           └── shared/
│
├── backend/
│   └── app/
│       ├── main.py
│       ├── feature_registry.py
│       │
│       ├── features/
│       │   ├── `<feature 1 name>`/
│       │   │   ├── feature.py
│       │   │   ├── router.py
│       │   │   ├── models.py
│       │   │   ├── schemas.py
│       │   │   ├── service.py
│       │   │   ├── repository.py
│       │   │   ├── migrations/
│       │   │   └── SKILL.md (when to call this, how to call this with api endpoints)
│       │   │
│       │   ├── `<feature 2 name>`/
│       │   │   ├── feature.py
│       │   │   ├── router.py
│       │   │   ├── models.py
│       │   │   ├── schemas.py
│       │   │   ├── service.py
│       │   │   ├── repository.py
│       │   │   ├── migrations/
│       │   │   └── SKILL.md (when to call this, how to call this with api endpoints)
│
├── data/
│   ├── jarvis.db
│   └── feature_settings.json (to turn feature on and off)
│
└── docs/
    └── FEATURE_SYSTEM.md ( How to use, dependancy of other feature and all aspects of that feature)
