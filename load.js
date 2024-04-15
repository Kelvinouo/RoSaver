let rsaver_placeid

function waitForElm(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
};

async function notification(title, message) {
    await chrome.runtime.sendMessage({
        type: "notification",
        title: title,
        message: message
    })
}

function makePurchase(productID, savedprice, type) {
    // let postData = JSON.stringify({
    //     expectedCurrency: 1,
    //     expectedPrice: price,
    //     expectedSellerId: sellerID,
    //     expectedPromoId: 0,
    //     userAssetId: 0,
    //     saleLocationType: "Game",
    //     saleLocationId: rsaver_placeid
    // })
    // return fetch(
    //         `https://economy.roblox.com/v1/purchases/products/${productID}`, {
    //             method: "POST",
    //             headers: {
    //                 "X-CSRF-TOKEN": csrf,
    //                 "Content-Type": "application/json"
    //             },
    //             credentials: "include",
    //             body: postData,
    //         })
    //     .then((resq) => {
    //         console.log(resq)
    //         return resq.json();
    //     })

    window.open(`roblox://placeId=${rsaver_placeid}&launchData=${productID},${savedprice},${type}`)
    window.location.reload()
};

(async () => {
    let storageData = await chrome.storage.local.get()

    if (!storageData.totalSaved) storageData.totalSaved = 0
    if (!storageData.placeid) storageData.placeid = 0
    rsaver_placeid = storageData.placeid

    function saveData(object) {
        chrome.storage.local.set(object)
    }

    saveData(storageData)

    // let PurchaseButton = await waitForElm("#item-info-container-frontend > div > div.item-details-section > div.price-row-container > div > div > div.price-info.row-content > div.item-purchase-btns-container > div > button")
    // PurchaseButton = $(PurchaseButton)
    let requireRobux = await waitForElm(".text-robux-lg")
    requireRobux = $(requireRobux).text()
    let infoDiv = await waitForElm("#item-container")
    infoDiv = $(infoDiv)
    console.log("Init RoSaver")

    let robuxContainer = $(".icon-robux-price-container")
    if (requireRobux === "") return

    // let productID = infoDiv.attr("data-delete-id")
    let productID = window.location.toString().split("/")[4]
    // if (!Number(productID)) return
    let price = requireRobux.replace(",", "")
    let sellerID = infoDiv.attr("data-expected-seller-id")
    let savedRobux

    let imgSrc = ""
    if ($("span.thumbnail-span > img").length > 0)   {
        imgSrc = $("span.thumbnail-span > img")[0].src
    }

    let CSRF_Token = ""
    if ($('meta[name="csrf-token"]').length > 0) {
        CSRF_Token = $('meta[name="csrf-token"]').attr("data-token")
    }

    let type = ""
    if ($(".icon-limited-label").length > 0 || $(".icon-limited-unique-label").length > 0) {
        type = "limiteds"
    } else if (window.location.href.indexOf("game-pass") > -1) {
        type = 2
    } else if (window.location.href.indexOf("bundles") > -1) {
        type = 3
    } else {
        type = 1
    }

    if (!storageData.placeid || rsaver_placeid == 0) {
        robuxContainer.append(`<span class="rsaver-savingRobux">(⚠ set placeid!)</span>`)
        return
    }
    
    if (type == 2) {
        savedRobux = Math.floor(price * 0.1)
    } else {
        savedRobux = Math.floor(price * 0.4)
    }

    if (type !== "limiteds") {
        robuxContainer.append(`<span class="rsaver-savingRobux">(💰${savedRobux})</span>`)
    } else {
        return
    }

    $(document.body).on("click", () => {
        if ($(`.text-robux`).length > 0) {
            // $("#modal-dialog").css("width", "500")
            let confirmButton = $(".modal-button.btn-primary-md.btn-min-width").length > 0 ? $(".modal-button.btn-primary-md.btn-min-width") : $("#confirm-btn") //decline-btn confirm-btn

            if (!confirmButton) return
            if ($('.modal-button.btn-primary-md.btn-min-width').length == 2) return
            if ($('#confirm-btn').hasClass("rsaver")) return
            if (confirmButton.offsetParent()[0].toString() == "[object HTMLHtmlElement]") return

            let clone = confirmButton.clone()
            clone.css({
                "background-color": "#00b06f",
                "border-color": "#00b06f",
                "color": "#fff"
            })
            clone.addClass("rsaver")
            clone.html(`Save <span class="icon-robux-16x16 wait-for-i18n-format-render"></span> ${savedRobux}`)
            clone.prependTo(confirmButton.parent())
            // confirmButton.remove()
            clone.on("click", (e) => {
                e.preventDefault()
                //if (confirmButton.text() == "Buy Now") {
                    $("div[role='dialog']").remove()
                    makePurchase(productID, savedRobux, type)
                        .then((resp) => {
                            console.log(resp)
                            // if (savedRobux !== 0) {
                            //     notification("Saved robux from RoSaver!" ,"You saved " + savedRobux + " robux by using RoSaver!")
                            //     console.log("sent!")
                            //     // setTimeout(() => window.location.reload(), 500);
                            // }
                        })
                //}
            })
        }
    });

})();