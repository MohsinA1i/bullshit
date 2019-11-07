const {
	Aborter,
	StorageURL,
	ServiceURL,
	ShareURL,
	DirectoryURL,
	FileURL,
	SharedKeyCredential,
	AnonymousCredential
} = require("@azure/storage-file");
// Enter your storage account name and shared key
const account = "taharazastorageaccount";
const accountKey = "jKLRQKYUXsRctlORL5AsFBJr9TmcG/lmQgbrYtI3Asmv5X6FlGu7rWiVY167QHW99hpN7LIgePnuar5ZfHjLKg==";
const sharedKeyCredential = new SharedKeyCredential(account, accountKey);
// Use sharedKeyCredential or anonymousCredential to create a pipeline
const pipeline = StorageURL.newPipeline(sharedKeyCredential);
const serviceURL = new ServiceURL(
	"https://" + account + ".file.core.windows.net",
	pipeline
);
const shareURL = ShareURL.fromServiceURL(serviceURL, "bullshit");

exports.saveFile = async function (image, userID, content) {
	const directoryName = image ? "images" : "thumbnails";
	const directoryURL = DirectoryURL.fromShareURL(shareURL, directoryName);
	const fileURL = FileURL.fromDirectoryURL(directoryURL, userID + ".jpg");
	await fileURL.create(Aborter.none, content.length);
	await fileURL.uploadRange(Aborter.none, content, 0, content.length);
}

exports.getFile = async function (image, userID) {
	const directoryName = image ? "images" : "thumbnails";
	const directoryURL = DirectoryURL.fromShareURL(shareURL, directoryName);
	const fileURL = FileURL.fromDirectoryURL(directoryURL, userID + ".jpg");
	const downloadFileResponse = await fileURL.download(Aborter.none, 0).catch(() => { });
	if (downloadFileResponse == null)
		return null;
	const bytes = await streamToData(downloadFileResponse.readableStreamBody).catch(() => console.log("Error parsing file"));
	return [...bytes];
}

async function streamToData(readableStream) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		readableStream.on("data", data => {
			chunks.push(data);
		});
		readableStream.on("end", () => {
			resolve(chunks[0]);
		});
		readableStream.on("error", reject);
	});
}