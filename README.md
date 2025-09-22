# directus-extension-downloadfolderorfilesaszip-endpoint
Directus custom endpoint extension allowing to download and save folder content or multiple files as zip.

Internal Directus authentication / permissions is handled using configured directus_folders permissions.

This extension is based on recent comment on associated RFC: https://github.com/directus/directus/discussions/20601#discussioncomment-14398376.

## Develop:
```
npm run dev
```
https://docs.directus.io/extensions/creating-extensions.html

## Publish:
```
npm run build && npm publish
```
https://docs.directus.io/extensions/creating-extensions.html

## Install:
```
pnpm install directus-extension-downloadfolderorfilesaszip-endpoint
```
https://docs.directus.io/extensions/installing-extensions.html

## Usage:

### Download content of a directory as Zip file:
GET /directus-extension-downloadfolderorfilesaszip-endpoint/folders/$FOLDER_ID

### Download specific files as Zip file:
POST /directus-extension-downloadfolderorfilesaszip-endpoint/files
Payload: [$FILES_IDs]
