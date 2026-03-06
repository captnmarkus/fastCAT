$sourceExt = @('.ts','.tsx','.js','.jsx','.mjs','.cjs','.py')
Get-ChildItem -Recurse -File | Where-Object {
  $sourceExt -contains $_.Extension -and $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\build\\|\\coverage\\|\\__pycache__\\'
} | ForEach-Object {
  $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
  [pscustomobject]@{ Lines = $lines; Path = $_.FullName.Substring((Get-Location).Path.Length + 1) }
} | Sort-Object Lines -Descending | Select-Object -First 30 | ForEach-Object { "{0}`t{1}" -f $_.Lines, $_.Path }
