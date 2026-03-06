 = Get-Content 'C:\Dev\Frontend-Majordhome\_invoicing_spec.json' -Raw | ConvertFrom-Json
Write-Host '=== invoicing schema ==='
if (.definitions) { .definitions | Get-Member -MemberType NoteProperty | ForEach-Object { Write-Host extglob.Name } } else { Write-Host ('Error: ' + .message) }

 = Get-Content 'C:\Dev\Frontend-Majordhome\_arpet_spec.json' -Raw | ConvertFrom-Json
Write-Host '=== arpet schema ==='
if (.definitions) { .definitions | Get-Member -MemberType NoteProperty | ForEach-Object { Write-Host extglob.Name } } else { Write-Host ('Error: ' + .message) }

 = Get-Content 'C:\Dev\Frontend-Majordhome\_perfec_spec.json' -Raw | ConvertFrom-Json
Write-Host '=== perfec schema ==='
if (.definitions) { .definitions | Get-Member -MemberType NoteProperty | ForEach-Object { Write-Host extglob.Name } } else { Write-Host ('Error: ' + .message) }
