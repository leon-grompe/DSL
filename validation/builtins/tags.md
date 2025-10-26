# Validations from "tags.ts"

tagsShouldNotHaveDuplicateEntries 
    node: SdsDeclaration
    'warning', "The tag '${evaluatedTag.value}' was set already."
    CODE_TAGS_DUPLICATE_TAG


## Assessment
Unsure