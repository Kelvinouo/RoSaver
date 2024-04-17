async function notification(title, message) {
    await chrome.runtime.sendMessage({
        type: "notification",
        title: title,
        message: message
    })
}

(async () => {
    let storageData = await chrome.storage.local.get()

    function saveData(object) {
        chrome.storage.local.set(object)
    }

    $("#rsaver-currect-placeid").text(storageData.placeid || 0)
    
    $("#rsaver-save").on("click", () => {
        if ($("#rsaver-placeid").val() === "") return

        storageData.placeid = parseInt($("#rsaver-placeid").val())
        $("#rsaver-currect-placeid").text(storageData.placeid)
        saveData(storageData)
        notification("Success changing placeid", "Refresh the tab to apply changes")
        window.location.reload()
    })

    let a = await fetch("https://raw.githubusercontent.com/Kelvinouo/RoSaver/master/news.txt").then(d => d.text())
    console.log(a)
    $(".rsaver").append(a)

    $("#simuna").on("click", () => {
        chrome.tabs.create({
            url: `https://discord.gg/frrQSPVajK`,
            active: true
        });
    })

    $("#discord").on("click", () => {
        chrome.tabs.create({
            url: `https://discord.gg/Bc2yG4Ea52`,
            active: true
        });
    })
})();