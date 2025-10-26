# Validations from "statements.ts"

statementMustDoSomething 
    node: SdsStatement
    'warning', 'This statement does nothing.'
    CODE_STATEMENT_HAS_NO_EFFECT
    -
    'warning', 'This statement does nothing.' + 'Did you mean to assign or output the result?'
    CODE_STATEMENT_HAS_NO_EFFECT


## Assessment
Probably not possible?
Maybe in second case: create output or variable