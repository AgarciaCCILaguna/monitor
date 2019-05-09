const Supplier = require('./../models/supplier.model').Supplier;
const {Contract} = require('./../models/contract.model');

const logger = require('./../components/logger').instance;

const {ExcelExporter} = require('./../components/exporter');

function _getPageFromReq(req) {
    return Number(req.query.page) || 1;
}

function _aggregateSuppliersFromContracts(req, res, options = {}, callback) {
    
    let paginate = !!options.paginate;

    let aggregate = Contract.aggregate([
        {
            $group: {
                _id: '$supplier',

                contractsCount: {$sum: 1},
                publicCount: {
                    $sum: {
                        $cond: {
                            if: {$eq: ["$procedureType", "PUBLIC"]},
                            then: 1,
                            else: 0
                        }
                    }
                },
                invitationCount: {
                    $sum: {
                        $cond: {
                            if: {$eq: ["$procedureType", "INVITATION"]},
                            then: 1,
                            else: 0
                        }
                    }
                },
                noBidCount: {
                    $sum: {
                        $cond: {
                            if: {$eq: ["$procedureType", "NO_BID"]},
                            then: 1,
                            else: 0
                        }
                    }
                },

                public: {
                    $sum: {
                        $cond: {
                            if: {$eq: ["$procedureType", "PUBLIC"]},
                            then: "$totalOrMaxAmount",
                            else: 0
                        }
                    }
                },
                invitation: {
                    $sum: {
                        $cond: {
                            if: {$eq: ["$procedureType", "INVITATION"]},
                            then: "$totalOrMaxAmount",
                            else: 0
                        }
                    }
                },
                noBid: {
                    $sum: {
                        $cond: {
                            if: {$eq: ["$procedureType", "NO_BID"]},
                            then: "$totalOrMaxAmount",
                            else: 0
                        }
                    }
                },
                total: {$sum: "$totalOrMaxAmount"}
            }
        },
        {
            $lookup: {
                from: Supplier.collection.name,
                let: { "supplierId": "$_id" },
                pipeline: [
                    {
                        "$match": {
                            "$expr": {
                                "$eq": [ "$_id", "$$supplierId" ] }
                        }
                    },
                    {
                        "$project": {
                            "name": 1
                        }
                    }
                ],
                as: "supplier"
            }
        },
        {
            $unwind: {
                path: "$supplier",
                preserveNullAndEmptyArrays: true
            },
        },
        {
            $project: {
                name: "$supplier.name",
                contractsCount: 1,
                publicCount: 1,
                invitationCount: 1,
                noBidCount: 1,

                public: 1,
                invitation: 1,
                noBid: 1,
                total: 1
            }
        }
    ]);
    
    if (!paginate) {
        return aggregate.exec(callback);
    } else {

        let page = _getPageFromReq(req);
        let paginateOptions = {
            page: page,
            limit: 10,
            sortBy: {
                total: -1
            }
        };
        
        return Contract.aggregatePaginate(aggregate, paginateOptions, callback);
    }
}


exports.list = (req, res, next) => {

    let page = _getPageFromReq(req);

    _aggregateSuppliersFromContracts(req, res, {paginate: true}, (err, suppliers, pageCount, itemCount) => {
        if (err) {
            logger.error(err, req, 'publicSupplier.controller#list', 'Error trying to query suppliers info from aggregate');
            return res.json({
                error: true
            });
        }

        let totals = {
            totalCount: 0,
            publicCount: 0,
            invitationCount: 0,
            noBidCount: 0,

            total: 0,
            public: 0,
            invitation: 0,
            noBid: 0,
        };

        suppliers.forEach((supplierInfo) => {
            totals.totalCount += supplierInfo.contractsCount;
            totals.publicCount += supplierInfo.publicCount;
            totals.invitationCount += supplierInfo.invitationCount;
            totals.noBidCount += supplierInfo.noBidCount;

            totals.total += supplierInfo.publicCount;
            totals.public += supplierInfo.public;
            totals.invitation += supplierInfo.invitation;
            totals.noBid += supplierInfo.noBid;
        });

        let pagination = {
            total: itemCount,
            page: page,
            pages: pageCount
        };

        let data = {
            totals: totals,
            suppliers: suppliers,
            pagination: pagination
        };

        return res.json({
            error: false,
            data: data
        });
    });
};

exports.download = (req, res, next) => {
    let format = req.params.format;
    
    if (!['xls', 'pdf', 'json'].includes(format)) {
        res.status(404);
        return res.end();
    }

    _aggregateSuppliersFromContracts(req, res, {paginate: false}, (err, suppliers) => {
        new ExcelExporter()
            .setPropInfoArray([
                {
                    header: 'NOMBRE DEL PROVEEDOR',
                    propName: 'name'
                },
                {
                    header: 'LICITACIÓN PÚBLICA',
                    propName: 'public',
                    format: 'currency'
                },
                {
                    header: 'POR INVITACIÓN',
                    propName: 'invitation',
                    format: 'currency'
                },
                {
                    header: 'ADJ. DIRECTA',
                    propName: 'noBid',
                    format: 'currency'
                },
                {
                    header: 'MONTO TOTAL',
                    propName: 'total',
                    format: 'currency'
                },
            ])
            .setDocs(suppliers)
            .setTitle('Proveedores')
            .setFileName('proveedores')
            .exportToFile(req, res);
    });
    
};