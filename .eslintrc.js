module.exports = {
  root: true,
  extends: 'gasbuddy',
  parserOptions: {
    project: './tsconfig.test.json',
  },
  rules: {
    // Disabled to allow Prettier to own operator line-break formatting
    'operator-linebreak': 'off',
  },
  overrides: [
    {
      files: ['__tests__/**/*.ts'],
      env: { jest: true },
      rules: {
        'import/first': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      },
    },
    {
      files: ['client/**/*.ts'],
      parserOptions: {
        project: './client/tsconfig.test.json',
      },
    },
  ],
};
