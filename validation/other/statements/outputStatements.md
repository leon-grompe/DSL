# Validations from "outputStatements.ts"

outputStatementMustHaveValue 
    node: SdsOutputStatement
    'error', 'This expression does not produce a value to output.'
    CODE_OUTPUT_STATEMENT_NO_VALUE


outputStatementMustOnlyBeUsedInPipeline 
    node: SdsOutputStatement
    'error', 'Output statements can only be used in a pipeline.'
    CODE_OUTPUT_STATEMENT_ONLY_IN_PIPELINE


## Assessment
Probably not really possible/helpful
    Could insert "out ..."
    Could create pipeline around the statement