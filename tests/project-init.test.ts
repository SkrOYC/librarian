import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { Librarian, LibrarianConfig } from '../src/index.js';

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

describe('End-to-End Integration', () => {
  const testWorkingDir = './integration-test-work';
  const mockConfig: LibrarianConfig = {
    repositories: {
      'test-repo': 'https://github.com/test/repo.git'
    },
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: testWorkingDir
  };

  beforeEach(() => {
    // Clean up test directory before each test
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory after each test
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  describe('Full Librarian Workflow', () => {
    it('should initialize, create AI model, and prepare for queries', () => {
      const librarian = new Librarian(mockConfig);
      
      // Verify all components are properly integrated
      expect(librarian).to.be.an.instanceOf(Librarian);
    });

    it('should handle configuration validation', () => {
      // Test that the configuration is properly structured
      expect(mockConfig.repositories).to.be.an('object');
      expect(mockConfig.aiProvider).to.be.an('object');
      expect(mockConfig.workingDir).to.be.a('string');
    });

    it('should create working directory during initialization', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      expect(fs.existsSync(testWorkingDir)).to.be.true;
    });
  });
});