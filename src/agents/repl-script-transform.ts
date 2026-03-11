import ts from "typescript";

function sliceNode(sourceFile: ts.SourceFile, node: ts.Node): string {
  return sourceFile.text.slice(node.getStart(sourceFile), node.end);
}

function transformVariableDeclaration(
  sourceFile: ts.SourceFile,
  declaration: ts.VariableDeclaration,
): string {
  const initializer = declaration.initializer
    ? sliceNode(sourceFile, declaration.initializer)
    : "undefined";

  if (ts.isIdentifier(declaration.name)) {
    return `${declaration.name.text} = ${initializer};`;
  }

  const nameText = sliceNode(sourceFile, declaration.name);
  return `(${nameText} = ${initializer});`;
}

function transformTopLevelStatement(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
): string {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .map((declaration) => transformVariableDeclaration(sourceFile, declaration))
      .join("\n");
  }

  if (ts.isFunctionDeclaration(statement) && statement.name) {
    const original = sliceNode(sourceFile, statement);
    return `${statement.name.text} = ${original};`;
  }

  if (ts.isClassDeclaration(statement) && statement.name) {
    const original = sliceNode(sourceFile, statement);
    return `${statement.name.text} = ${original};`;
  }

  return sliceNode(sourceFile, statement);
}

export function transformReplScript(script: string): string {
  const syntaxCheck = ts.transpileModule(script, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  });

  const syntaxError = syntaxCheck.diagnostics?.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (syntaxError) {
    throw new Error(
      ts.flattenDiagnosticMessageText(syntaxError.messageText, "\n"),
    );
  }

  const sourceFile = ts.createSourceFile(
    "repl-script.ts",
    script,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  const transformedTs = sourceFile.statements
    .map((statement) => transformTopLevelStatement(sourceFile, statement))
    .join("\n");

  return ts.transpileModule(transformedTs, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
}
