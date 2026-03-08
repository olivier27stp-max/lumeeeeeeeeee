$lines = Get-Content "c:\Users\Rafba\OneDrive\Documents\Crm\lume-crm\.env.local"
foreach($line in $lines){
  if($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*)"?\s*$'){
    $name = $matches[1]
    $value = $matches[2].Trim('"')
    Set-Item -Path "Env:$name" -Value $value
  }
}
cd "c:\Users\Rafba\OneDrive\Documents\Crm\lume-crm"
npm run api:dev *> api-dev.log
