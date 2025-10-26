# Validations from "imports.ts"

importPackageMustNotBeEmpty 
    node: SdsImport
    'error', "The package '${node.package}' is empty."
    CODE_IMPORT_EMPTY_PACKAGE


## Assessment
Not sure. Could delete the import potentially