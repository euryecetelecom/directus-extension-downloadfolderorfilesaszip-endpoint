import archiver from 'archiver';
// Types are used in interface definitions
import { defineEndpoint } from '@directus/extensions-sdk';

interface FileItem {
	id: string;
	filename_download: string;
	type?: string | null;
	folder?: string | null;
	title?: string | null;
}

interface FolderItem {
	id: string;
	name: string;
	parent?: string | null;
}

export default defineEndpoint((router, { services, getSchema }) => {
	const { AssetsService, FilesService, FoldersService } = services;

	/**
	 * Recursively collect all files and subfolders from a parent folder
	 */
	async function collectFolderContentsRecursive(
		folderId: string,
		schema: any,
		accountability: any,
		path: string = ''
	): Promise<{ files: FileItem[], folders: FolderItem[], paths: Map<string, string> }> {
		const filesService = new FilesService({ schema, accountability });
		const foldersService = new FoldersService({ schema, accountability });
		
		const allFiles: FileItem[] = [];
		const allFolders: FolderItem[] = [];
		const filePaths = new Map<string, string>();

		try {
			// Get all files in current folder
			const files = await filesService.readByQuery({
				filter: { folder: { _eq: folderId } },
				fields: ['id', 'filename_download', 'type', 'folder', 'title'],
				limit: -1
			});

			// Add files to collection with their paths
			for (const file of files) {
				allFiles.push(file);
				const fileName = file.filename_download || file.title || `file_${file.id}`;
				filePaths.set(file.id, path ? `${path}/${fileName}` : fileName);
			}

			// Get all subfolders in current folder
			const folders = await foldersService.readByQuery({
				filter: { parent: { _eq: folderId } },
				fields: ['id', 'name', 'parent'],
				limit: -1
			}) as FolderItem[];

			// Recursively process each subfolder
			for (const folder of folders) {
				allFolders.push(folder);
				const folderPath = path ? `${path}/${folder.name}` : folder.name;
				
				const subContents = await collectFolderContentsRecursive(
					folder.id,
					schema,
					accountability,
					folderPath
				);
				
				allFiles.push(...subContents.files);
				allFolders.push(...subContents.folders);
				
				// Merge path maps
				subContents.paths.forEach((value, key) => {
					filePaths.set(key, value);
				});
			}
		} catch (error) {
			console.error(`Error collecting folder contents for folder ${folderId}:`, error);
			throw error;
		}

		return { files: allFiles, folders: allFolders, paths: filePaths };
	}

	/**
	 * Create and stream a ZIP archive containing the provided files
	 */
	async function createZipStream(
		files: FileItem[],
		filePaths: Map<string, string>,
		assetsService: any,
		res: any
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const archive = archiver('zip', {
				zlib: { level: 9 } // Maximum compression
			});

			// Set response headers for ZIP download
			res.setHeader('Content-Type', 'application/zip');
			res.setHeader('Content-Disposition', 'attachment; filename="download.zip"');

			// Pipe archive to response
			archive.pipe(res);

			// Handle archive events
			archive.on('error', (err: Error) => {
				console.error('Archive error:', err);
				reject(err);
			});

			archive.on('end', () => {
				console.log('Archive finalized');
				resolve();
			});

			// Add files to archive
			const addFilesToArchive = async () => {
				try {
					for (const file of files) {
						const filePath = filePaths.get(file.id) || file.filename_download || `file_${file.id}`;
						
						try {
							// Get file stream from AssetsService
							const { stream } = await assetsService.getAsset(file.id);
							
							if (stream) {
								archive.append(stream, { name: filePath });
							} else {
								console.warn(`No stream available for file ${file.id}`);
							}
						} catch (fileError) {
							console.error(`Error adding file ${file.id} to archive:`, fileError);
							// Continue with other files instead of failing completely
						}
					}

					// Finalize the archive
					await archive.finalize();
				} catch (error) {
					reject(error);
				}
			};

			addFilesToArchive();
		});
	}

	// Download folder and all nested content as ZIP
	router.get('/folders/:id', async (req: any, res: any) => {
		try {
			const folderId = req.params.id;
			console.log('Bulk download requested for folder:', folderId);

			const schema = await getSchema();
			const assetsService = new AssetsService({ 
				schema, 
				accountability: req.accountability 
			});
			const foldersService = new FoldersService({ 
				schema, 
				accountability: req.accountability 
			});

			// Verify folder exists
			const folder = await foldersService.readOne(folderId, {
				fields: ['id', 'name']
			});

			if (!folder) {
				return res.status(404).json({
					error: 'Folder not found'
				});
			}

			// Collect all files and folders recursively
			const { files, paths } = await collectFolderContentsRecursive(
				folderId,
				schema,
				req.accountability
			);

			console.log(`Found ${files.length} files to download from folder: ${folder.name}`);

			if (files.length === 0) {
				return res.status(400).json({
					error: 'No files found in the specified folder'
				});
			}

			// Set filename based on folder name
			const zipFilename = `${folder.name.replace(/[^a-zA-Z0-9]/g, '_')}.zip`;
			res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

			// Create and stream ZIP
			await createZipStream(files, paths, assetsService, res);

		} catch (error) {
			console.error('Error in bulk folder download:', error);
			
			if (!res.headersSent) {
				return res.status(500).json({
					error: 'Failed to create download archive',
					details: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		}
	});

	// Download multiple files as ZIP
	router.post('/files', async (req: any, res: any) => {
		try {
			const fileIds = req.body;
			
			if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
				return res.status(400).json({
					error: 'An array of files IDs is required and must not be empty'
				});
			}

			console.log('Bulk download requested for files:', fileIds);

			const schema = await getSchema();
			const filesService = new FilesService({ 
				schema, 
				accountability: req.accountability 
			});
			const assetsService = new AssetsService({ 
				schema, 
				accountability: req.accountability 
			});

			// Get file information
			const files = await filesService.readByQuery({
				filter: { id: { _in: fileIds } },
				fields: ['id', 'filename_download', 'type', 'title'],
				limit: -1
			});

			if (files.length === 0) {
				return res.status(404).json({
					error: 'No files found with the provided IDs'
				});
			}

			// Create simple path mapping for individual files
			const filePaths = new Map<string, string>();
			files.forEach((file: FileItem) => {
				const fileName = file.filename_download || file.title || `file_${file.id}`;
				filePaths.set(file.id, fileName);
			});

			console.log(`Found ${files.length} files to download`);

			// Set ZIP filename
			const zipFilename = `files_${new Date().toISOString().split('T')[0]}.zip`;
			res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

			// Create and stream ZIP
			await createZipStream(files, filePaths, assetsService, res);

		} catch (error) {
			console.error('Error in bulk files download:', error);
			
			if (!res.headersSent) {
				return res.status(500).json({
					error: 'Failed to create download archive',
					details: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		}
	});
});