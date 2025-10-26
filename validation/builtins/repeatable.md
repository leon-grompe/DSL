# Validations from "repeatable.ts"

singleUseAnnotationsMustNotBeRepeated 
    node: SdsDeclaration
    'error', "The annotation '${duplicate.annotation?.$refText}' is not repeatable."
    CODE_ANNOTATION_NOT_REPEATABLE


## Assessment
Probably not possible? Maybe just delete the entire annotation