import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      "**/.next/**",
      "**/.next-prod/**",
      "**/node_modules/**",
      "firebase-debug.log",
    ],
  },
  ...nextVitals,
  {
    rules: {
      // Too strict for current stage; re-enable gradually
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
