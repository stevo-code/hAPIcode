; Script NSIS personnalise pour hAPIcode.
;
; Probleme : l'app vit dans la zone de notification (systray) et intercepte la fermeture
; de fenetre (WM_CLOSE -> masquer au lieu de quitter). Du coup, lors d'une mise a jour,
; l'installateur NSIS n'arrive pas a la fermer poliment et affiche
;   « hAPIcode ne peut pas etre ferme. Veuillez la fermer manuellement... ».
;
; Solution : forcer la fermeture du process (et de son arbre) AVANT le controle d'instance
; en cours. taskkill /F est necessaire car un signal de fermeture poli serait ignore.
; preInit s'execute tres tot dans .onInit (avant le check d'app en cours), customInit juste
; apres : on couvre les deux pour garantir que le process est bien terminé.

!macro killHapicode
  nsExec::Exec '"$SYSDIR\cmd.exe" /c taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Sleep 600
!macroend

!macro preInit
  !insertmacro killHapicode
!macroend

!macro customInit
  !insertmacro killHapicode
!macroend
