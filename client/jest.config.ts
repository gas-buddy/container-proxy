import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  testRegex: '(\\.|/)((test|spec))\\.[jt]sx?$',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.test.json' }],
  },
};

export default config;
