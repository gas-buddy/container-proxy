// @ts-check
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gbCoconfig = require('@gasbuddy/coconfig');
const config = gbCoconfig.default || gbCoconfig;

// Exclude the client workspace directory from root tsconfig scans
config['tsconfig.json'].configuration.exclude = ['node_modules', 'build', 'client'];
// TypeScript 6 deprecates baseUrl — silence the warning
config['tsconfig.json'].configuration.compilerOptions.ignoreDeprecations = '6.0';
// Include jest types for __tests__/ files; base tsconfig only has node
config['tsconfig.json'].configuration.compilerOptions.types = ['node', 'jest'];
// rootDir set to "." so both src/ and __tests__/ are included; TS6 requires
// explicit rootDir when outDir is set. tsconfig.build.json overrides to ./src.
config['tsconfig.json'].configuration.compilerOptions.rootDir = '.';
// tsconfig.build.json excludes tests and only compiles src/, so rootDir is safe there
config['tsconfig.build.json'].configuration.compilerOptions = {
  ...config['tsconfig.build.json'].configuration.compilerOptions,
  rootDir: './src',
};
config['tsconfig.build.json'].configuration.exclude = [
  'src/**/*.spec.ts',
  'src/**/*.test.ts',
  '__tests__/**/*.ts',
  '__mocks__/**/*.ts',
  'coconfig.js',
  'client',
];

// Preserve the client entry in .npmignore (coconfig template doesn't include it)
config['.npmignore'] = `client\n${config['.npmignore']}`;

// Add test environment and client workspace parser overrides to ESLint
config['.eslintrc.js'].configuration.overrides = [
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
      project: './client/tsconfig.json',
    },
  },
];

// Exclude client directory from root Jest runs
const jestCfg = config['jest.config.js'].configuration;
const resolvedJest = typeof jestCfg === 'function' ? jestCfg() : jestCfg;
resolvedJest.testPathIgnorePatterns = ['/node_modules/', '/build/', '/client/'];
config['jest.config.js'].configuration = resolvedJest;

module.exports = config;
