# Validations from "placeholders.ts"

placeholdersMustNotBeAnAlias 
    node: SdsPlaceholder
    'error', 'Aliases are not allowed to provide a cleaner graphical view.'
    CODE_PLACEHOLDER_ALIAS


placeholderShouldBeUsed 
    node: SdsPlaceholder
    warning', 'This placeholder is unused and can be removed. Prefix its name with an underscore to disable this warning.'
    CODE_PLACEHOLDER_UNUSED


## Assessment
Unsure about aliases
Remove Placeholders