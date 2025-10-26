# Validations from "pythonName.ts"

pythonNameMustNotBeSetIfPythonMacroIsSet 
    node: SdsFunction
    'error', 'A Python name must not be set if a Python call is set.'
    CODE_PYTHON_NAME_MUTUALLY_EXCLUSIVE_WITH_PYTHON_MACRO


pythonNameShouldDifferFromSafeDsName 
    node: SdsDeclaration
    'info', 'The Python name is identical to the Safe-DS name, so the annotation call can be removed.'
    CODE_PYTHON_NAME_SAME_AS_SAFE_DS_NAME


## Assessment