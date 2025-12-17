let rsaver_placeid
let currentUrl = window.location.href
let isInitializing = false

// Check if current URL is an item detail page (has numeric ID)
function isItemDetailPage(url = window.location.href) {
	// Match patterns like /catalog/12345/..., /bundles/12345/..., /game-pass/12345/...
	const match = url.match(/\/(catalog|bundles|game-pass)\/(\d+)/)
	return match !== null
}

function waitForElm(selector, timeout = 5000) {
	return new Promise((resolve, reject) => {
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

		// Timeout to prevent infinite waiting
		setTimeout(() => {
			observer.disconnect();
			reject(new Error(`Element ${selector} not found within ${timeout}ms`));
		}, timeout);
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
	window.open(`roblox://placeId=${rsaver_placeid}&launchData=${productID},${savedprice},${type}`)
	window.location.reload()
};

// Clean up previous RoSaver elements
function cleanup() {
	$(".rsaver-savingRobux").remove()
	$(".rsaver").remove()
}

// Add savings indicators to listing pages (game passes, catalog items)
function addSavingsToListings() {
	// Game pass store cards - 10% savings
	$(".store-card-price").each(function() {
		if ($(this).find(".rsaver-savingRobux").length > 0) return // Already added
		
		const priceElm = $(this).find(".text-robux")
		if (priceElm.length === 0) return
		
		const price = parseInt(priceElm.text().replace(/,/g, ""))
		if (isNaN(price) || price === 0) return
		
		const savedRobux = Math.floor(price * 0.1) // 10% for game passes
		priceElm.after(`<span class="rsaver-savingRobux text-success font-caption-body" style="margin-left: 4px;">(💰${savedRobux})</span>`)
	})
	
	// Catalog item cards - 40% savings (or 10% for bundles)
	$(".item-card-price").each(function() {
		if ($(this).find(".rsaver-savingRobux").length > 0) return // Already added
		
		const priceElm = $(this).find(".text-robux-tile")
		if (priceElm.length === 0) return
		
		const price = parseInt(priceElm.text().replace(/,/g, ""))
		if (isNaN(price) || price === 0) return
		
		// Check if it's a bundle (bundles get 10% savings, regular items get 40%)
		const itemLink = $(this).closest(".item-card-container").find("a").attr("href") || ""
		const isBundle = itemLink.includes("/bundles/")
		
		const savedRobux = Math.floor(price * (isBundle ? 0.1 : 0.4))
		priceElm.after(`<span class="rsaver-savingRobux text-success font-caption-body" style="margin-left: 4px;">(💰${savedRobux})</span>`)
	})
}

// Watch for new items being added (infinite scroll, etc.)
function watchForNewListings() {
	const listingObserver = new MutationObserver((mutations) => {
		let hasNewItems = false
		for (const mutation of mutations) {
			if (mutation.addedNodes.length > 0) {
				// Check if new store cards or item cards were added
				for (const node of mutation.addedNodes) {
					if (node.nodeType === 1) { // Element node
						if ($(node).find(".store-card-price, .item-card-price").length > 0 || 
							$(node).hasClass("store-card") || 
							$(node).hasClass("item-card-container") ||
							$(node).hasClass("catalog-item-container")) {
							hasNewItems = true
							break
						}
					}
				}
			}
			if (hasNewItems) break
		}
		
		if (hasNewItems) {
			// Small delay to let items fully render
			setTimeout(() => {
				addSavingsToListings()
			}, 100)
		}
	})
	
	listingObserver.observe(document.body, {
		childList: true,
		subtree: true
	})
}

async function initRoSaver() {
	// Prevent multiple simultaneous initializations
	if (isInitializing) return
	isInitializing = true

	try {
		// Clean up any existing RoSaver elements from previous page
		cleanup()

		let storageData = await chrome.storage.local.get()

		if (!storageData.totalSaved) storageData.totalSaved = 0
		if (!storageData.placeid) storageData.placeid = 0
		rsaver_placeid = storageData.placeid

		function saveData(object) {
			chrome.storage.local.set(object)
		}

		saveData(storageData)

		// Wait for the new item details container structure
		let requireRobuxElm = await waitForElm(".text-robux-lg")
		let requireRobux = $(requireRobuxElm).text().trim()
		
		// Updated selector for the new Roblox layout
		let infoDiv = await waitForElm("#item-details, .item-details-info-content, .shopping-cart.item-details-info-content")
		infoDiv = $(infoDiv)
		console.log("Init RoSaver - Price:", requireRobux)

		// Wait for the robux price container to be ready
		let robuxContainerElm = await waitForElm(".icon-robux-price-container, .price-info.row-content .icon-text-wrapper, .item-price-value")
		let robuxContainer = $(robuxContainerElm)
		console.log("RoSaver - Found price container:", robuxContainer.length > 0)
		
		if (requireRobux === "") {
			console.log("RoSaver - No price found, exiting")
			return
		}

		let productID = window.location.toString().split("/")[4]
		let price = requireRobux.replace(",", "")
		let savedRobux

		// Updated thumbnail selector for new layout
		let imgSrc = ""
		if ($(".thumbnail-2d-container img").length > 0) {
			imgSrc = $(".thumbnail-2d-container img")[0].src
		} else if ($("span.thumbnail-span > img").length > 0) {
			imgSrc = $("span.thumbnail-span > img")[0].src
		}

		let CSRF_Token = ""
		if ($('meta[name="csrf-token"]').length > 0) {
			CSRF_Token = $('meta[name="csrf-token"]').attr("data-token")
		}

		// Detect item type - updated selectors for new layout
		let type = ""
		
		// Check for limited items using multiple methods
		const limitedSelectors = [
			".icon-limited-label",
			".icon-limited-unique-label", 
			".icon-limited",
			".limited-icon",
			"[class*='limitedIcon']",
			"[class*='limited-icon']",
			"[data-testid*='limited']",
			".asset-restriction-icon .icon-limited-label",
			".item-restriction-icon"
		]
		
		let isLimited = false
		for (const selector of limitedSelectors) {
			if ($(selector).length > 0) {
				isLimited = true
				break
			}
		}
		
		// Also check for "Limited" text in specific areas
		if (!isLimited) {
			const pageText = $("#item-details").text() || $(".item-details-info-content").text() || ""
			if (pageText.includes("Limited") || pageText.includes("Collectible")) {
				isLimited = true
			}
		}
		
		// Check data attributes on the item container
		if (!isLimited) {
			const itemContainer = $("[data-is-limited='true'], [data-item-status*='limited']")
			if (itemContainer.length > 0) {
				isLimited = true
			}
		}
		
		// Check for resale/resellers section (only limited items have this)
		if (!isLimited) {
			const resaleSection = $(".resale-pricechart-tabs, .resellers-container, #asset-resale-data-container, [class*='resale'], [class*='reseller']")
			if (resaleSection.length > 0 && resaleSection.text().trim() !== "") {
				isLimited = true
			}
		}
		
		// Check for "Tradable: Yes" which indicates limited
		if (!isLimited) {
			const tradableText = $("#tradable-content").text().trim()
			if (tradableText === "Yes") {
				isLimited = true
			}
		}
		
		if (isLimited) {
			type = "limiteds"
		} else if (window.location.href.indexOf("game-pass") > -1) {
			type = 2
		} else if (window.location.href.indexOf("bundles") > -1) {
			type = 3
		} else {
			type = 1
		}

		if (!storageData.placeid || rsaver_placeid == 0) {
			robuxContainer.append(`
				<span class="rsaver-savingRobux rsaver-warning text-error font-caption-header">
					⚠️ RoSaver Setup Required
					<a href="https://www.youtube.com/video/icx6SWPOPQ4" 
					   target="_blank" 
					   class="btn-secondary-xs text-link"
					>📺 Watch Setup Tutorial</a>
				</span>
			`)
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

		// Function to add the Save button to the modal
		function addSaveButton() {
			if ($('.rsaver').length > 0) return // Already added our button
			
			// Try multiple selectors for the confirm button in the new layout
			let confirmButton = null
			
			const buttonSelectors = [
				".modal-button.btn-primary-md.btn-min-width",
				"#confirm-btn",
				".btn-primary-lg[type='button']",
				".modal-footer .btn-primary-md",
				".purchase-modal button.btn-primary-md",
				"[data-testid='confirm-btn']",
				".modal-content button.btn-primary-md"
			]
			
			for (const selector of buttonSelectors) {
				const btn = $(selector).not(".rsaver").first()
				if (btn.length > 0) {
					confirmButton = btn
					break
				}
			}

			if (!confirmButton || confirmButton.length === 0) return
			
			try {
				if (confirmButton.offsetParent()[0].toString() == "[object HTMLHtmlElement]") return
			} catch (e) {
				// Ignore offsetParent errors
			}

			let clone = confirmButton.clone()
			clone.css({
				"background-color": "#00b06f",
				"border-color": "#00b06f",
				"color": "#fff"
			})
			clone.addClass("rsaver")
			clone.html(`Save <span class="icon-robux-16x16 wait-for-i18n-format-render"></span> ${savedRobux}`)
			clone.prependTo(confirmButton.parent())
			
			clone.on("click", (e) => {
				e.preventDefault()
				e.stopPropagation()
				// Close the modal
				$("div[role='dialog']").remove()
				$(".modal-backdrop").remove()
				$(".modal").remove()
				$(".modal-window").remove()
				
				makePurchase(productID, savedRobux, type)
					.then((resp) => {
						console.log(resp)
					})
			})
		}

		// Watch for modal appearing using MutationObserver
		const modalObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.addedNodes.length > 0) {
					// Check if a modal was added
					const hasModal = $(".modal-window, .modal-content, [class*='modal']").length > 0
					const hasModalButton = $(".modal-button, .modal-footer button").length > 0
					
					if (hasModal && hasModalButton) {
						// Small delay to ensure modal is fully rendered
						setTimeout(() => {
							addSaveButton()
						}, 100)
					}
				}
			}
		})
		
		modalObserver.observe(document.body, {
			childList: true,
			subtree: true
		})

		// Also handle click as backup (with delay)
		$(document.body).off("click.rosaver")
		$(document.body).on("click.rosaver", () => {
			// Check for purchase modal with delay
			setTimeout(() => {
				if ($(".modal-window, .modal-content").length > 0) {
					addSaveButton()
				}
			}, 200)
		});

	} catch (error) {
		console.log("RoSaver - Error or timeout:", error.message)
	} finally {
		isInitializing = false
	}
}

// Watch for URL changes (SPA navigation)
function watchForUrlChanges() {
	// Check for URL changes periodically
	setInterval(() => {
		if (currentUrl !== window.location.href) {
			console.log("RoSaver - URL changed to:", window.location.href)
			currentUrl = window.location.href
			
			// Only run on item detail pages (has numeric ID)
			if (isItemDetailPage(currentUrl)) {
				console.log("RoSaver - Item detail page detected, reinitializing...")
				// Small delay to let the new page content load
				setTimeout(() => {
					initRoSaver()
				}, 800)
			} else {
				// Clean up if navigating away from item page
				cleanup()
				// Re-add savings to any listings on the new page
				setTimeout(() => {
					addSavingsToListings()
				}, 500)
			}
		}
	}, 300)
}

// Also watch for popstate events (back/forward navigation)
window.addEventListener("popstate", () => {
	console.log("RoSaver - Popstate event")
	currentUrl = window.location.href
	
	if (isItemDetailPage(currentUrl)) {
		console.log("RoSaver - Item detail page detected, reinitializing...")
		setTimeout(() => {
			initRoSaver()
		}, 800)
	} else {
		cleanup()
		setTimeout(() => {
			addSavingsToListings()
		}, 500)
	}
});

// Initial run
(async () => {
	const storageData = await chrome.storage.local.get()
	rsaver_placeid = storageData.placeid || 0
	
	if (isItemDetailPage()) {
		console.log("RoSaver - Starting on item detail page")
		initRoSaver()
	} else {
		console.log("RoSaver - Not on item detail page, adding savings to listings...")
	}
	
	// Always add savings to listings (game passes, catalog items)
	addSavingsToListings()
	watchForNewListings()
	watchForUrlChanges()
})()
