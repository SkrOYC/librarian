import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

describe('Project Initialization', () => {
  describe('package.json', () => {
    it('should exist in the project root', () => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      expect(fs.existsSync(packageJsonPath)).to.be.true;
    });

    it('should have required fields', () => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      expect(pkg.name).to.exist;
      expect(pkg.version).to.exist;
      expect(pkg.description).to.exist;
      expect(pkg.main).to.exist;
      expect(pkg.scripts).to.exist;
      expect(pkg.dependencies).to.exist;
      expect(pkg.devDependencies).to.exist;
    });
  });

  describe('TypeScript Configuration', () => {
    it('should have tsconfig.json in project root', () => {
      const tsConfigPath = path.join(__dirname, '../tsconfig.json');
      expect(fs.existsSync(tsConfigPath)).to.be.true;
    });

    it('should have proper TypeScript compiler options', () => {
      const tsConfigPath = path.join(__dirname, '../tsconfig.json');
      const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf8'));
      
      expect(tsConfig.compilerOptions).to.exist;
      expect(tsConfig.compilerOptions.target).to.exist;
      expect(tsConfig.compilerOptions.module).to.exist;
      expect(tsConfig.compilerOptions.outDir).to.exist;
      expect(tsConfig.compilerOptions.rootDir).to.exist;
      expect(tsConfig.compilerOptions.strict).to.exist;
      expect(tsConfig.compilerOptions.esModuleInterop).to.exist;
    });
  });
});